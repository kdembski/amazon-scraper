export const codedError = (message: string, code: string) =>
  Object.assign(new Error(message), { code });

export const timedOut = (message = "Request aborted") => codedError(message, "ETIMEDOUT");

// Settles like the promise, or rejects with timedOut() once the signal aborts,
// after onAbort ran
export const raceAbort = <T>(
  promise: Promise<T>,
  signal: AbortSignal,
  message?: string,
  onAbort = () => {}
) => {
  let listener!: () => void;
  const aborted = new Promise<never>((_, reject) => {
    listener = () => {
      onAbort();
      reject(timedOut(message));
    };
    signal.addEventListener("abort", listener, { once: true });
  });

  return Promise.race([promise, aborted]).finally(() =>
    signal.removeEventListener("abort", listener)
  );
};
