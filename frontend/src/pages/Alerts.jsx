import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { BellRing, AlertTriangle, CheckCheck, BellOff } from "lucide-react";

const sevStyle = {
  high: "border-destructive/40 bg-destructive/5",
  medium: "border-[hsl(16_42%_58%/0.4)] bg-[hsl(16_42%_58%/0.05)]",
  low: "border-accent/40 bg-accent/5",
};
const sevBadge = {
  high: "bg-destructive text-destructive-foreground",
  medium: "bg-[hsl(16_42%_58%)] text-white",
  low: "bg-accent text-accent-foreground",
};

export default function Alerts() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["alerts"],
    queryFn: async () => (await api.get("/alerts")).data,
  });

  const readMut = useMutation({
    mutationFn: async (id) => (await api.post(`/alerts/${id}/read`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["alerts"] }),
  });

  const alerts = data?.alerts || [];

  return (
    <div className="p-6 md:p-10 max-w-4xl fade-up">
      <header className="mb-8">
        <p className="text-xs uppercase tracking-[0.2em] font-semibold text-muted-foreground mb-2">Monitoring</p>
        <h1 className="font-heading text-3xl sm:text-4xl font-light tracking-tight">Alerts</h1>
        <p className="text-sm text-muted-foreground mt-2">Anomalies flagged by AI during analysis.</p>
      </header>

      {isLoading ? (
        <div className="space-y-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20" />)}</div>
      ) : alerts.length === 0 ? (
        <Card className="p-12 text-center" data-testid="alerts-empty">
          <div className="mx-auto h-14 w-14 rounded-full bg-secondary flex items-center justify-center mb-5">
            <BellOff className="h-6 w-6 text-muted-foreground" />
          </div>
          <h3 className="font-heading text-xl font-medium mb-2">All clear</h3>
          <p className="text-sm text-muted-foreground">No anomalies detected. Run an AI analysis to scan your latest data.</p>
        </Card>
      ) : (
        <div className="space-y-3" data-testid="alerts-list">
          {alerts.map((a) => (
            <Card key={a.id} className={`p-5 border ${sevStyle[a.severity] || sevStyle.medium} ${a.read ? "opacity-60" : ""}`} data-testid={`alert-${a.id}`}>
              <div className="flex items-start gap-3">
                <div className="h-9 w-9 rounded-full bg-card border border-border flex items-center justify-center shrink-0">
                  {a.read ? <BellRing className="h-4 w-4 text-muted-foreground" /> : <AlertTriangle className="h-4 w-4 text-destructive" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="font-heading font-medium">{a.title}</h4>
                    <Badge className={`text-xs ${sevBadge[a.severity] || sevBadge.medium}`}>{a.severity}</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{a.detail}</p>
                  <p className="text-xs text-muted-foreground mt-2">{(a.created_at || "").slice(0, 16).replace("T", " ")}</p>
                </div>
                {!a.read && (
                  <Button variant="ghost" size="sm" className="gap-1.5 shrink-0" onClick={() => readMut.mutate(a.id)} data-testid={`dismiss-alert-${a.id}`}>
                    <CheckCheck className="h-4 w-4" /> Dismiss
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
