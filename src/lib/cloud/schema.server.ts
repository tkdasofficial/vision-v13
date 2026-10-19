// Column types for every app table stored in Cloudflare D1.
export type ColKind = "text" | "num" | "bool" | "json";
export const TABLES: Record<string, { key: string; cols: Record<string, ColKind> }> = {
 "admin_audit_log": {
  "key": "id",
  "cols": {
   "action": "text",
   "admin_id": "text",
   "created_at": "text",
   "details": "json",
   "id": "text",
   "target_id": "text",
   "target_type": "text"
  }
 },
 "admin_notifications": {
  "key": "id",
  "cols": {
   "created_at": "text",
   "created_by": "text",
   "id": "text",
   "message": "text",
   "target": "text",
   "title": "text"
  }
 },
 "ai_usage_logs": {
  "key": "id",
  "cols": {
   "capability": "text",
   "created_at": "text",
   "function_name": "text",
   "id": "text",
   "metadata": "json",
   "provider": "text",
   "source": "text",
   "status": "text",
   "tokens": "num",
   "user_id": "text"
  }
 },
 "announcements": {
  "key": "id",
  "cols": {
   "active": "bool",
   "body": "text",
   "created_at": "text",
   "created_by": "text",
   "ends_at": "text",
   "id": "text",
   "level": "text",
   "starts_at": "text",
   "title": "text"
  }
 },
 "background_tasks": {
  "key": "id",
  "cols": {
   "created_at": "text",
   "error": "text",
   "id": "text",
   "input": "json",
   "progress": "num",
   "result": "json",
   "session_id": "text",
   "status": "text",
   "task_type": "text",
   "updated_at": "text",
   "user_id": "text"
  }
 },
 "chat_messages": {
  "key": "id",
  "cols": {
   "content": "text",
   "created_at": "text",
   "id": "text",
   "image_url": "text",
   "metadata": "json",
   "role": "text",
   "session_id": "text"
  }
 },
 "chat_sessions": {
  "key": "id",
  "cols": {
   "created_at": "text",
   "id": "text",
   "mode": "text",
   "pinned": "bool",
   "preview": "text",
   "project_id": "text",
   "story_state": "json",
   "title": "text",
   "tool_id": "text",
   "updated_at": "text",
   "user_id": "text"
  }
 },
 "feature_flags": {
  "key": "key",
  "cols": {
   "description": "text",
   "enabled": "bool",
   "key": "text",
   "updated_at": "text",
   "value": "json"
  }
 },
 "leads": {
  "key": "id",
  "cols": {
   "avg_views": "num",
   "campaign_id": "text",
   "channel_url": "text",
   "created_at": "text",
   "display_name": "text",
   "email": "text",
   "email_status": "text",
   "id": "text",
   "industry": "text",
   "metadata": "json",
   "niche": "text",
   "primary_domain": "text",
   "prospecting_job_id": "text",
   "source": "text",
   "source_id": "text",
   "status": "text",
   "subscriber_count": "num",
   "updated_at": "text",
   "user_id": "text",
   "workflow_id": "text"
  }
 },
 "outreach_campaigns": {
  "key": "id",
  "cols": {
   "created_at": "text",
   "daily_cap": "num",
   "follow_up_enabled": "bool",
   "id": "text",
   "name": "text",
   "pitch_context": "text",
   "status": "text",
   "throttle_max_sec": "num",
   "throttle_min_sec": "num",
   "tone": "text",
   "updated_at": "text",
   "user_id": "text"
  }
 },
 "plan_limits": {
  "key": "plan",
  "cols": {
   "active": "bool",
   "created_at": "text",
   "display_name": "text",
   "features": "json",
   "limits": "json",
   "plan": "text",
   "popular": "bool",
   "price_monthly": "num",
   "price_yearly": "num",
   "sort_order": "num",
   "tagline": "text",
   "updated_at": "text"
  }
 },
 "profiles": {
  "key": "id",
  "cols": {
   "avatar_url": "text",
   "created_at": "text",
   "email": "text",
   "full_name": "text",
   "id": "text",
   "is_banned": "bool",
   "updated_at": "text"
  }
 },
 "prospecting_jobs": {
  "key": "id",
  "cols": {
   "created_at": "text",
   "error": "text",
   "found_count": "num",
   "id": "text",
   "params": "json",
   "source": "text",
   "status": "text",
   "target_count": "num",
   "updated_at": "text",
   "user_id": "text"
  }
 },
 "story_projects": {
  "key": "id",
  "cols": {
   "analysis": "json",
   "audience": "text",
   "audio_url": "text",
   "category": "text",
   "characters": "json",
   "created_at": "text",
   "error": "text",
   "generation_mode": "text",
   "id": "text",
   "language": "text",
   "length": "text",
   "progress": "json",
   "prompts": "json",
   "scenes": "json",
   "script": "text",
   "session_id": "text",
   "status": "text",
   "title": "text",
   "topic": "text",
   "updated_at": "text",
   "user_id": "text"
  }
 },
 "subscriptions": {
  "key": "id",
  "cols": {
   "billing_cycle": "text",
   "created_at": "text",
   "expires_at": "text",
   "id": "text",
   "plan": "text",
   "status": "text",
   "updated_at": "text",
   "user_id": "text"
  }
 },
 "support_tickets": {
  "key": "id",
  "cols": {
   "admin_reply": "text",
   "created_at": "text",
   "id": "text",
   "message": "text",
   "priority": "text",
   "replied_at": "text",
   "replied_by": "text",
   "status": "text",
   "subject": "text",
   "updated_at": "text",
   "user_id": "text"
  }
 },
 "user_2fa": {
  "key": "id",
  "cols": {
   "created_at": "text",
   "enabled": "bool",
   "id": "text",
   "method": "text",
   "updated_at": "text",
   "user_id": "text"
  }
 },
 "user_roles": {
  "key": "id",
  "cols": {
   "created_at": "text",
   "id": "text",
   "role": "text",
   "user_id": "text"
  }
 },
 "user_settings": {
  "key": "id",
  "cols": {
   "created_at": "text",
   "default_tool": "text",
   "id": "text",
   "language": "text",
   "prefs": "text",
   "notifications_enabled": "bool",
   "theme": "text",
   "updated_at": "text",
   "user_id": "text"
  }
 },
 "user_files": {
  "key": "id",
  "cols": {
   "id": "text",
   "user_id": "text",
   "name": "text",
   "mime": "text",
   "kind": "text",
   "size": "num",
   "drive_file_id": "text",
   "url": "text",
   "project_id": "text",
   "created_at": "text"
  }
 },
 "workspace_projects": {
  "key": "id",
  "cols": {
   "id": "text",
   "user_id": "text",
   "name": "text",
   "icon": "text",
   "category": "text",
   "session_id": "text",
   "pinned": "bool",
   "instructions": "text",
   "memory": "text",
   "created_at": "text",
   "updated_at": "text"
  }
 }
};
