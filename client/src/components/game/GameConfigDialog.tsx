import { GameConfigPanel } from "@/components/game/GameConfigPanel";
import { Dialog } from "@/components/ui/dialog";
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
  /**
   * When false, the dialog cannot be dismissed by the user (Esc key,
   * backdrop click, or the close X are all disabled). Used by the local
   * and computer game pages where the dialog acts as a mandatory setup
   * gate — the only way out is to click the submit button.
   */
  closeable?: boolean;
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
  closeable = true,
}: GameConfigDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      closeable={closeable}
    >
      <GameConfigPanel
        {...config.configPanelProps}
        submitLabel={submitLabel}
        onSubmit={onSubmit}
        busy={busy}
      />
    </Dialog>
  );
}
