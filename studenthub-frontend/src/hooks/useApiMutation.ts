import { useCallback, useState } from "react";

type MutationState<T, P> = {
  data: T | null;
  error: unknown;
  isLoading: boolean;
  mutate: (payload: P) => Promise<T | null>;
  reset: () => void;
};

export const useApiMutation = <T, P = void>(
  mutationFn: (payload: P) => Promise<T>,
): MutationState<T, P> => {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const mutate = useCallback(
    async (payload: P) => {
      setIsLoading(true);
      setError(null);
      try {
        const result = await mutationFn(payload);
        setData(result);
        return result;
      } catch (err) {
        setError(err);
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [mutationFn],
  );

  const reset = useCallback(() => {
    setData(null);
    setError(null);
    setIsLoading(false);
  }, []);

  return { data, error, isLoading, mutate, reset };
};
