import { Dialog } from "@/components/ui/dialog";
import { GameConfigPanel } from "@/components/game/GameConfigPanel";
import type { useGameConfig } from "@/lib/hooks/useGameConfig";

type GameConfigDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  config: ReturnType<typeof useGameConfig>;
  submitLabel: string;
  onSubmit: () => void;
  busy?: boolean;
};

export function GameConfigDialog({
  open,
  onOpenChange,
  title,
  description,
  config,
  submitLabel,
  onSubmit,
  busy,
}: GameConfigDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title} description={description}>
      <GameConfigPanel
        {...config.configPanelProps}
        submitLabel={submitLabel}
        onSubmit={onSubmit}
        busy={busy}
      />
    </Dialog>
  );
}
