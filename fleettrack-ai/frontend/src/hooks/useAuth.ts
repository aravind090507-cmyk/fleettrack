import { useAuthStore } from '../store/authStore';

export function useAuth() {
  const { user, token, isAuthenticated, isLoading, error, login, logout, loadUser, setError } =
    useAuthStore();

  const isAdmin = user?.role === 'admin';
  const isFleetManager = user?.role === 'fleet_manager';

  return {
    user,
    token,
    isAuthenticated,
    isLoading,
    error,
    isAdmin,
    isFleetManager,
    role: user?.role,
    login,
    logout,
    loadUser,
    setError,
  };
}

export default useAuth;
