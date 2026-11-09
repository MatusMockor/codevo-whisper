export function EngineSwitchError({ message }: { message: string | null }) {
  if (message === null) {
    return null;
  }
  return (
    <p className="save-error switch-error" role="alert">
      {message}
    </p>
  );
}
