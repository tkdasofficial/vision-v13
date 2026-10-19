import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/cloud/client";
import type { LocalUser as User, LocalSession as Session } from "@/lib/cloud/client";

type Profile = {
  id: string;
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
};

type AuthContextType = {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  isAdmin: boolean;
  loading: boolean;
  /** The server couldn't be reached to confirm the session; still retrying. */
  offline: boolean;
  signOut: () => Promise<void>;
};

const AuthContext: import("react").Context<AuthContextType | null> =
  ((globalThis as any).__sc_auth_ctx__ ??= createContext<AuthContextType | null>(null));

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const queryClient = useQueryClient();

  const fetchProfile = async (userId: string) => {
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .single();
    if (data) setProfile(data as Profile);
  };

  const checkAdmin = async (userId: string) => {
    const { data } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();
    setIsAdmin(!!data);
  };

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        setSession(session);
        setUser(session?.user ?? null);

        if (session?.user) {
          setTimeout(() => {
            fetchProfile(session.user.id);
            checkAdmin(session.user.id);
          }, 0);
        } else {
          setProfile(null);
          setIsAdmin(false);
        }
        setLoading(false);
      }
    );

    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const verify = () => supabase.auth.getSession().then(({ data: { session }, error }) => {
      if (error) {
        // Couldn't reach the server: stay in the loading state and try again, never sign out.
        setOffline(true);
        retryTimer = setTimeout(verify, 5000);
        return;
      }
      setOffline(false);
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchProfile(session.user.id);
        checkAdmin(session.user.id);
      }
      setLoading(false);
    });
    verify();

    return () => { clearTimeout(retryTimer); subscription.unsubscribe(); };
  }, []);

  const signOut = async () => {
    await queryClient.cancelQueries();
    await supabase.auth.signOut();
    queryClient.clear();
    setUser(null);
    setSession(null);
    setProfile(null);
    setIsAdmin(false);
  };

  return (
    <AuthContext.Provider value={{ user, session, profile, isAdmin, loading, offline, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
};
