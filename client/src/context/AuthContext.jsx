import { createContext, useContext, useState, useEffect } from "react";
import { supabase } from "../utils/supabaseClient";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const handleSession = (session) => {
    if (session) {
      const u = session.user;
      setUser({
        ...u,
        ...(u.user_metadata || {})
      });
    } else {
      setUser(null);
    }
    setLoading(false);
  };

  useEffect(() => {
    // Check active session on mount
    supabase.auth
      .getSession()
      .then(({ data } = {}) => {
        handleSession(data?.session || null);
      })
      .catch((err) => {
        console.warn("Failed to get session:", err);
        setLoading(false);
      });

    // Listen for auth state changes
    try {
      const { data } = supabase.auth.onAuthStateChange((_event, session) => {
        handleSession(session);
      });

      return () => data?.subscription?.unsubscribe?.();
    } catch (err) {
      console.warn("Failed to subscribe to auth state changes:", err);
    }
  }, []);

  const login = async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw new Error(error.message);
    return { ...data.user, ...(data.user?.user_metadata || {}) };
  };

  const signup = async (email, password, full_name, nickname) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name,
          nickname,
          user_type: "organizer" // Web signup defaults to organizer? Or what? We will map it in UI if needed
        }
      }
    });
    if (error) throw new Error(error.message);
    return { ...data.user, ...(data.user?.user_metadata || {}) };
  };

  const volunteerSignup = async (email, password, full_name, nickname, invitation_token) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name,
          nickname,
          user_type: "volunteer",
          invitation_token // Backend should verify this upon first access!
        }
      }
    });
    if (error) throw new Error(error.message);
    return { ...data.user, ...(data.user?.user_metadata || {}) };
  };

  const logout = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw new Error(error.message);
  };

  const value = {
    user,
    isAuthenticated: !!user,
    login,
    signup,
    volunteerSignup,
    logout,
    loading,
  };

  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
