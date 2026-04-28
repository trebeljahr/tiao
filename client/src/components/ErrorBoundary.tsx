import { useTranslations } from "next-intl";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { captureException } from "@/lib/glitchtip";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

function ErrorFallback({ error }: { error: Error | null }) {
  const t = useTranslations("error");

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6 py-12 text-foreground">
      <div className="w-full max-w-md rounded-3xl border border-border/80 bg-card/95 px-8 py-7 text-center shadow-2xl">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl border border-black/10 bg-red-100 font-display text-4xl text-red-600 shadow-xs">
          !
        </div>
        <h1 className="mt-4 font-display text-3xl font-bold">{t("somethingWentWrong")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("unexpectedError")}</p>
        {error && (
          <pre className="mt-4 max-h-32 overflow-auto rounded-lg bg-black/5 p-3 text-left text-xs text-red-500">
            {error.message}
          </pre>
        )}
        <Button className="mt-6 w-full" onClick={() => window.location.assign("/")}>
          {t("backToHome")}
        </Button>
      </div>
    </div>
  );
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
    captureException(error, { componentStack: errorInfo.componentStack ?? undefined });
  }

  public render() {
    if (this.state.hasError) {
      return <ErrorFallback error={this.state.error} />;
    }

    return this.props.children;
  }
}
