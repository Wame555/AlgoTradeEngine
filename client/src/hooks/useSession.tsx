import { createContext, useContext } from 'react';
import { useQuery } from '@tanstack/react-query';
import { SessionData } from '@/types/trading';

interface SessionContextValue {
  session: SessionData | undefined;
  isLoading: boolean;
  error: unknown;
  refetch: () => void;
}

const SessionContext = createContext<SessionContextValue | undefined>(undefined);

function SessionLoadingScreen() {
  return (
    <div className="flex h-screen w-full items-center justify-center bg-background text-muted-foreground">
      <div className="space-y-3 text-center">
        <div className="h-12 w-12 animate-spin rounded-full border-2 border-muted border-t-primary mx-auto" />
        <p>Initializing trading workspace...</p>
      </div>
    </div>
  );
}

function SessionErrorScreen({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex h-screen w-full items-center justify-center bg-background text-muted-foreground">
      <div className="space-y-4 text-center">
        <p className="text-lg font-semibold">Failed to load user session</p>
        <p className="text-sm">Please check the server logs and try again.</p>
        <button
          type="button"
          onClick={onRetry}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Retry
        </button>
      </div>
    </div>
  );
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const { data, isLoading, error, refetch } = useQuery<SessionData>({
    queryKey: ['/api/session'],
    staleTime: Infinity,
    retry: 1,
  });

  if (isLoading) {
    return <SessionLoadingScreen />;
  }

  if (error) {
    return <SessionErrorScreen onRetry={() => refetch()} />;
  }

  return (
    <SessionContext.Provider
      value={{
        session: data,
        isLoading: false,
        error: undefined,
        refetch: () => {
          void refetch();
        },
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error('useSession must be used within a SessionProvider');
  }
  return context;
}

export function useUserId(): string | undefined {
  const { session } = useSession();
  return session?.user.id;
}
