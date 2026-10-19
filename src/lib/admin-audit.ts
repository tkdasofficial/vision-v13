import { supabase } from "@/lib/cloud/client";

export async function logAdminAction(
  action: string,
  targetType?: string,
  targetId?: string,
  details: Record<string, any> = {}
) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await supabase.from("admin_audit_log").insert({
    admin_id: user.id,
    action,
    target_type: targetType ?? null,
    target_id: targetId ?? null,
    details,
  });
}
