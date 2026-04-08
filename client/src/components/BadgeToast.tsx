import { UserBadge, type BadgeId } from "@/components/UserBadge";

/**
 * Toast payload that renders a `<UserBadge>` next to a title/description.
 *
 * Use this anywhere a toast refers to a specific badge — the user sees the
 * actual badge visual instead of having its id or name interpolated into a
 * sentence. Sonner accepts a ReactNode as the first argument to `toast(...)`,
 * so: `toast.success(<BadgeToast badge="supporter" title={t("badgeUpdatedShort")} />)`.
 */
export function BadgeToast({
  badge,
  title,
  description,
}: {
  badge: BadgeId;
  title: string;
  description?: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <UserBadge badge={badge} />
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-[#2b1e14]">{title}</p>
        {description && <p className="truncate text-xs text-[#5a4632]">{description}</p>}
      </div>
    </div>
  );
}
