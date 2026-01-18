import { useEffect, useState } from "react";

type QueryState<T> = {
  data: T | null;
  error: unknown;
  isLoading: boolean;
  reload: () => void;
};

export const useApiQuery = <T>(queryFn: () => Promise<T>, deps: unknown[] = []): QueryState<T> => {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let isActive = true;
    setIsLoading(true);
    setError(null);

    queryFn()
      .then((result) => {
        if (isActive) {
          setData(result);
        }
      })
      .catch((err) => {
        if (isActive) {
          setError(err);
        }
      })
      .finally(() => {
        if (isActive) {
          setIsLoading(false);
        }
      });

    return () => {
      isActive = false;
    };
  }, [queryFn, reloadToken, ...deps]);

  const reload = () => setReloadToken((value) => value + 1);

  return { data, error, isLoading, reload };
};
