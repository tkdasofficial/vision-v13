// Starts a job and runs it to completion inside the request; the browser polls /api/jobs/$jobId meanwhile.
import { ARCHIVE_LIMITS } from "../../../security/archive/zip-guard";
import type { JobType } from "@/lib/builder/statuses";
import { createJob, getJob, safeError } from "./jobs.server";

export async function startJob(userId: string, id: string, type: JobType, input: any, attempt = 1, sessionId: string | null = null) {
  // Idempotency: the client mints one id per intentional request. A replay of the same id by the same user
  // (double tap, network retry) returns the existing job instead of running file work twice. A new request,
  // even with identical text, gets a new id and runs normally. Retries of failed jobs use their own path.
  if (attempt === 1) {
    const existing = await getJob(userId, id).catch(() => null);
    if (existing) return existing;
  }
  const { prepareKeepAlive } = await import("./chat-background.server");
  const keepAlive = await prepareKeepAlive();
  const stored = type === "runtime_task" ? { operation: input.operation, params: input.params, fileName: input.fileName, mime: input.mime, sourceArtifactId: input.sourceArtifactId ?? null } : type === "zip_analyze" ? { fileName: input.fileName, sourceArtifactId: input.sourceArtifactId ?? null } : type === "agent_task" ? { prompt: input.prompt, sources: input.sources ?? [], ...(input.resumeFrom ? { resumeFrom: input.resumeFrom } : {}) } : input;
  const job = await createJob(id, userId, type, stored, attempt, sessionId);
  const { runCodeExport, runProjectGenerate, runZipAnalyze } = await import("./runners.server");
  const run = (async () => {
  try {
    if (type === "code_export") await runCodeExport(job, input);
    else if (type === "project_generate") await runProjectGenerate(job, input);
    else if (type === "runtime_task") {
      let bytes: Uint8Array = input.bytes;
      if (!bytes && input.sourceArtifactId) { await job.step("downloading", "Loading the original file"); bytes = await loadSource(userId, input.sourceArtifactId); }
      const { startRuntimeJob } = await import("@/lib/runtime/runtime.server");
      await startRuntimeJob(job, { operation: input.operation, params: input.params, fileName: input.fileName, mime: input.mime, bytes });
    }
    else if (type === "long_context") {
      const { runLongContext } = await import("./long-context.server");
      await runLongContext(job, input);
    }
    else if (type === "agent_task") {
      const files: { name: string; mime: string; bytes: Uint8Array }[] = input.files ?? [];
      const sources: { id: string; name: string; mime: string }[] = input.sources ?? [];
      if (files.length) {
        await job.step("uploading", `Storing ${files.length} file(s) privately for retries`);
        for (const f of files) { const ref = await job.saveArtifact(f.name, f.mime || "application/octet-stream", f.bytes, "source"); sources.push({ id: ref.id, name: f.name, mime: f.mime }); }
        const { d1 } = await import("@/lib/cloud/d1.server");
        await d1("UPDATE jobs SET input = ? WHERE id = ?", [JSON.stringify({ prompt: input.prompt, sources }), id]);
      } else if (sources.length) {
        await job.step("downloading", "Loading the attached files");
        for (const s of sources) files.push({ name: s.name, mime: s.mime, bytes: await loadSource(userId, s.id) });
      }
      const { runAgent } = await import("./agent.server");
      const { claimResume, persistCheckpoint } = await import("./resume.server");
      const resume = input.resumeFrom ? await claimResume(job, input.resumeFrom) : null;
      await runAgent(job, { prompt: input.prompt, files }, (f) => job.saveArtifact(f.name, f.mime, f.bytes, "file"), { resume, persist: (cp) => persistCheckpoint(userId, id, cp) });
    }
    else {
      let bytes: Uint8Array = input.bytes;
      if (!bytes && input.sourceArtifactId) {
        await job.step("downloading", "Loading the uploaded ZIP");
        bytes = await loadSource(userId, input.sourceArtifactId);
      }
      if (!bytes) throw new Error("No ZIP file provided.");
      if (bytes.length > ARCHIVE_LIMITS.maxUploadBytes) throw new Error("ZIP is larger than 25 MB.");
      if (!input.sourceArtifactId) {
        await job.step("uploading", "Storing the ZIP privately for retries");
        const ref = await job.saveArtifact(input.fileName, "application/zip", bytes, "source");
        const { d1 } = await import("@/lib/cloud/d1.server");
        await d1("UPDATE jobs SET input = ? WHERE id = ?", [JSON.stringify({ fileName: input.fileName, sourceArtifactId: ref.id }), id]);
      }
      await runZipAnalyze(job, { fileName: input.fileName, bytes });
    }
  } catch (e) {
    console.error("[jobs]", type, safeError(e));
    await job.fail(e);
  }
  })();
  // Register synchronously while the request is active. Runtime lifetime limits
  // still apply; durable checkpoints support retry if the host interrupts work.
  keepAlive(run);
  // Fast tasks still return their final view in the same request; slow ones return "running".
  await Promise.race([run, new Promise((r) => setTimeout(r, 20_000))]);
  return getJob(userId, id);
}

async function loadSource(userId: string, artifactId: string): Promise<Uint8Array> {
  const { d1 } = await import("@/lib/cloud/d1.server");
  const rows = await d1<any>("SELECT drive_file_id, expires_at FROM job_artifacts WHERE id = ? AND user_id = ? AND kind = 'source'", [artifactId, userId]);
  if (!rows[0] || Date.parse(rows[0].expires_at) <= Date.now()) throw new Error("The original file has expired. Please upload it again.");
  const { getArtifactBytes } = await import("./artifact-store.server");
  return getArtifactBytes(rows[0].drive_file_id);
}
