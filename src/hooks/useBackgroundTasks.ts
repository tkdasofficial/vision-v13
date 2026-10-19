import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/cloud/client";
import { useAuth } from "@/context/AuthContext";

export type BackgroundTask = {
  id: string;
  user_id: string;
  session_id: string | null;
  task_type: string;
  status: string;
  input: any;
  result: any;
  progress: number;
  error: string | null;
  created_at: string;
  updated_at: string;
};

const TASK_WORKER_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/task-worker`;

export function useBackgroundTasks(sessionId?: string | null) {
  const { user } = useAuth();
  const [tasks, setTasks] = useState<BackgroundTask[]>([]);
  const [activeTasks, setActiveTasks] = useState<BackgroundTask[]>([]);

  // Load existing tasks for this session
  useEffect(() => {
    if (!user || !sessionId) return;

    const loadTasks = async () => {
      const { data } = await supabase
        .from("background_tasks")
        .select("*")
        .eq("session_id", sessionId)
        .order("created_at", { ascending: true });

      if (data) setTasks(data as BackgroundTask[]);
    };

    loadTasks();
  }, [user, sessionId]);

  // Load all active (running/pending) tasks for user
  useEffect(() => {
    if (!user) return;

    const loadActive = async () => {
      const { data } = await supabase
        .from("background_tasks")
        .select("*")
        .eq("user_id", user.id)
        .in("status", ["pending", "running"])
        .order("created_at", { ascending: false });

      if (data) setActiveTasks(data as BackgroundTask[]);
    };

    loadActive();
  }, [user]);

  // Subscribe to realtime updates
  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel("background-tasks-realtime")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "background_tasks",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const task = payload.new as BackgroundTask;

          // Update session tasks
          setTasks((prev) => {
            const idx = prev.findIndex((t) => t.id === task.id);
            if (idx >= 0) {
              const updated = [...prev];
              updated[idx] = task;
              return updated;
            }
            if (sessionId && task.session_id === sessionId) {
              return [...prev, task];
            }
            return prev;
          });

          // Update active tasks
          setActiveTasks((prev) => {
            if (task.status === "done" || task.status === "error") {
              return prev.filter((t) => t.id !== task.id);
            }
            const idx = prev.findIndex((t) => t.id === task.id);
            if (idx >= 0) {
              const updated = [...prev];
              updated[idx] = task;
              return updated;
            }
            if (task.status === "pending" || task.status === "running") {
              return [task, ...prev];
            }
            return prev;
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, sessionId]);

  // Dispatch a new background task
  const dispatch = useCallback(
    async (taskType: string, input: any, chatSessionId?: string) => {
      if (!user) throw new Error("Not authenticated");

      const sid = chatSessionId || sessionId;

      // Insert task into DB
      const { data: task, error } = await supabase
        .from("background_tasks")
        .insert({
          user_id: user.id,
          session_id: sid,
          task_type: taskType,
          input,
          status: "pending",
        })
        .select()
        .single();

      if (error || !task) throw new Error(error?.message || "Failed to create task");

      // Fire-and-forget: trigger the worker
      fetch(TASK_WORKER_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ taskId: task.id }),
      }).catch((e) => console.warn("Worker trigger failed:", e));

      return task as BackgroundTask;
    },
    [user, sessionId]
  );

  return { tasks, activeTasks, dispatch };
}
