import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api, { formatApiErrorDetail } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Sparkles, Lightbulb, TrendingUp, AlertTriangle, Loader2, RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

const sevColor = {
  high: "bg-destructive/10 text-destructive border-destructive/30",
  medium: "bg-[hsl(16_42%_58%/0.12)] text-[hsl(16_42%_45%)] border-[hsl(16_42%_58%/0.3)]",
  low: "bg-accent/10 text-accent border-accent/30",
};

export default function Insights() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["ai-latest"],
    queryFn: async () => (await api.get("/ai/latest")).data,
  });

  const analyzeMut = useMutation({
    mutationFn: async () => (await api.post("/ai/analyze")).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ai-latest"] });
      qc.invalidateQueries({ queryKey: ["alerts"] });
      toast.success("Analysis complete");
    },
    onError: (e) => toast.error(formatApiErrorDetail(e.response?.data?.detail)),
  });

  const report = data?.report;

  return (
    <div className="p-6 md:p-10 max-w-6xl fade-up">
      <header className="flex flex-wrap items-end justify-between gap-4 mb-8">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] font-semibold text-muted-foreground mb-2">Intelligence</p>
          <h1 className="font-heading text-3xl sm:text-4xl font-light tracking-tight">AI Insights</h1>
          <p className="text-sm text-muted-foreground mt-2">Powered by Gemini 3.1 Pro · analyzes your encrypted ledger</p>
        </div>
        <Button onClick={() => analyzeMut.mutate()} disabled={analyzeMut.isPending} className="gap-2" data-testid="run-analysis-btn">
          {analyzeMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : report ? <RefreshCw className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
          {report ? "Re-analyze" : "Run analysis"}
        </Button>
      </header>

      {isLoading ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : analyzeMut.isPending ? (
        <Card className="p-12 text-center" data-testid="analysis-loading">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-4" />
          <p className="font-heading text-lg">Analyzing your finances…</p>
          <p className="text-sm text-muted-foreground mt-1">Surfacing insights, suggestions and anomalies.</p>
        </Card>
      ) : !report ? (
        <Card className="p-12 text-center bg-accent/5 border-accent/30" data-testid="insights-empty">
          <div className="mx-auto h-14 w-14 rounded-full bg-secondary flex items-center justify-center mb-5">
            <Sparkles className="h-6 w-6 text-primary" />
          </div>
          <h3 className="font-heading text-xl font-medium mb-2">No analysis yet</h3>
          <p className="text-sm text-muted-foreground max-w-md mx-auto mb-6">
            Run an AI analysis to get tailored insights, improvement suggestions, and anomaly alerts on your data.
          </p>
          <Button onClick={() => analyzeMut.mutate()} disabled={analyzeMut.isPending} className="gap-2" data-testid="empty-run-btn">
            <Sparkles className="h-4 w-4" /> Run analysis
          </Button>
        </Card>
      ) : (
        <div className="space-y-8">
          <Section title="Key Insights" icon={TrendingUp} testid="insights-section">
            <div className="grid md:grid-cols-2 gap-4">
              {report.insights?.map((it, i) => (
                <Card key={i} className="p-5 bg-accent/[0.06] border-accent/30" data-testid={`insight-${i}`}>
                  <h4 className="font-heading font-medium mb-1.5">{it.title}</h4>
                  <p className="text-sm text-muted-foreground leading-relaxed">{it.detail}</p>
                  {it.metric && <Badge variant="secondary" className="mt-3 font-normal">{it.metric}</Badge>}
                </Card>
              ))}
            </div>
          </Section>

          <Section title="Suggested Improvements" icon={Lightbulb} testid="suggestions-section">
            <div className="space-y-3">
              {report.suggestions?.map((s, i) => (
                <Card key={i} className="p-5 flex items-start gap-4" data-testid={`suggestion-${i}`}>
                  <div className="h-8 w-8 rounded-full bg-secondary flex items-center justify-center shrink-0">
                    <Lightbulb className="h-4 w-4 text-primary" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h4 className="font-heading font-medium">{s.title}</h4>
                      {s.impact && <Badge className={`text-xs border ${sevColor[s.impact] || sevColor.low}`} variant="outline">{s.impact} impact</Badge>}
                    </div>
                    <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{s.detail}</p>
                  </div>
                </Card>
              ))}
            </div>
          </Section>

          {report.alerts?.length > 0 && (
            <Section title="Anomaly Alerts" icon={AlertTriangle} testid="alerts-section">
              <div className="space-y-3">
                {report.alerts.map((a, i) => (
                  <Card key={i} className={`p-5 border ${sevColor[a.severity] || sevColor.medium}`} data-testid={`ai-alert-${i}`}>
                    <div className="flex items-start gap-3">
                      <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
                      <div>
                        <h4 className="font-heading font-medium">{a.title}</h4>
                        <p className="text-sm opacity-90 mt-1 leading-relaxed">{a.detail}</p>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </Section>
          )}
          <p className="text-xs text-muted-foreground">Generated {(report.created_at || "").slice(0, 16).replace("T", " ")}</p>
        </div>
      )}
    </div>
  );
}

const Section = ({ title, icon: Icon, children, testid }) => (
  <section data-testid={testid}>
    <div className="flex items-center gap-2 mb-4">
      <Icon className="h-4 w-4 text-primary" />
      <h2 className="font-heading text-xl font-medium">{title}</h2>
    </div>
    {children}
  </section>
);
