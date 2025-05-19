import { Progress as ProgressBar } from "./ui/progress";

export function Progress({
  phase,
  loaded,
  total,
}: {
  phase: string;
  loaded: number;
  total: number;
}) {
  return (
    <div className="flex items-center">
      <p className="text-sm pr-2">{phase}</p>
      <div className="w-24">
        <ProgressBar value={(loaded / total) * 100} />
      </div>
      <p className="pl-2 text-sm">{`${loaded} / ${total}`}</p>
    </div>
  );
}
