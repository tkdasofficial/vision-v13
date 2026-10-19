# Google Drive storage implementation report

## Storage flow
Creation/conversion → existing output validation → authenticated Cloudflare storage → private Drive category/format folder → read-back size/SHA-256 verification → D1 file/artifact index → authenticated application download. Source artifacts and runtime transfer staging remain bounded in D1. No Google credentials or public Drive permissions are sent to the browser.

## Folder tree
The tree is derived from 115 canonical writable formats; aliases share folders. Initialization creates/reuses these folders, but has not been run against live Drive.

```text
VISION/
  Documents/
    PDF, DOC, DOCX, TXT, MD, RTF, ODT, HTML, TEX
  Ebooks_and_Publishing/
    EPUB, MOBI, AZW3, FB2, CBZ
  Spreadsheets/
    XLS, XLSX, CSV, ODS, TSV
  Data_and_Databases/
    JSON, JSONL, XML, SQL, SQLITE, PARQUET, AVRO
  Configuration/
    YAML, TOML, ENV, INI, CFG, CONF, PROPERTIES, DOCKERFILE, GITIGNORE
  Presentations/
    PPT, PPTX, ODP
  Code_and_Development/
    CSS, JS, JSX, TS, TSX, MJS, CJS, PY, JAVA, C, CPP, H, HPP, CS, GO, RS, PHP, RB, SWIFT, KT, KTS, SH, BAT, PS1, IPYNB
  Images/
    PNG, JPEG, WEBP, BMP, TIFF, GIF, ICO, AVIF, SVG
  Audio/
    WAV, MP3, FLAC, OGG, M4A, AAC, WMA, OPUS, AIFF
  Video/
    MP4, WEBM, MOV, MKV, AVI, WMV, M4V, MPEG, 3GP
  Archives/
    ZIP, TAR, GZ, TGZ, 7Z
  Subtitles_and_Transcripts/
    SRT, VTT, ASS, SSA, LRC
  Diagrams_and_Graphics/
    MMD, DOT, PUML
  Fonts/
    TTF, OTF, WOFF, WOFF2
  Contacts/
    VCF
  Calendars/
    ICS
  Maps_and_Geospatial/
    KML, GPX, GEOJSON
  Logs_and_Diffs/
    LOG, DIFF, PATCH
  Other_Supported/
    Files
Writable canonical formats: 115
```

## Changed modules
- `cloud/drive-layout.ts`: canonical destination inventory and safe names.
- `cloud/drive.server.ts`: existing Drive adapter, runtime settings, private resumable uploads, folder/upload reservations, verification and reconciliation.
- `cloud/drive-migration.server.ts` and `/api/storage/drive`: admin-only initialization and three-artifact migration batches; preserve identifiers and verify bytes before replacing legacy references.
- `jobs/artifact-store.server.ts`, `jobs/jobs.server.ts`, `runtime/runtime.server.ts`: Drive final outputs, D1 staging, stable retry identities, metadata persistence and cleanup.
- `/api/files`: owner-only private download, existing upload/delete protections and Cloudflare proxy.
- `drive-export.ts`, code/ZIP/table exports, creator/converter cards, research-document PDF: authenticated storage before browser download/share.
- `download.ts`: permits authenticated HTML file attachments without accepting an accidental sign-in page.
- Scoped architecture guidance, roadmap and five affected/new regression files.

## Registry
Existing app_config holds folder IDs and upload reservations (reserved → verified → indexed), owner, canonical format, destination parent, byte count and hash. Existing user_files/job_artifacts hold user/job associations and private download references. Remote upload interruptions reconcile on the reserved Google ID; partial unpublished media can restart on that ID. Legacy migration updates the existing artifact reference before deleting unreferenced D1 bytes.

## Verification
- Full Vitest suite: **88 test files passed; 1375 tests passed, 1 skipped**.
- Targeted Drive, migration, browser-export and existing artifact/runtime/table regressions included in the full run.
- Automatic application validation: **build OK**, including type validation, latest observed 2026-10-17T04:51:44Z.
- Cloudflare settings read confirmed presence of GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN and GOOGLE_DRIVE_FOLDER_ID; values were not displayed or changed.
- Google uploads/folders were tested with mocks only. No live Google upload, folder initialization, legacy migration, or signed-in end-to-end download was performed. No deployment was performed.

## Remaining limitations and required next step
Deploy the updated Cloudflare service, then run authenticated admin initialization/migration and verify signed-in creation/conversion/download against Drive. Until deployment, the live service still uses its previous storage implementation. Existing D1 files are still present; legacy downloads remain supported. Migration covers unexpired final artifacts only, never source/runtime staging.

Final storage is bounded to 32 MiB; authenticated browser uploads and D1 runtime inputs remain limited to 25 MiB. Larger runtime outputs fail honestly instead of being marked delivered. This is not unbounded large-file streaming. Incognito browser downloads deliberately remain local to avoid persisting private session content. Folder canonicalization tests cover declared writer targets, not a live conversion run for every format. Runtime finalization and authenticated endpoint permissions still require live end-to-end verification. Atomic reserved IDs prevent duplicate files, but concurrent same-ID sessions can produce a retryable conflict, not a completed link. Cleanup failure after a delivered runtime output is non-fatal; later retention cleanup is still required.
