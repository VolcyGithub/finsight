import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api, { currency, formatApiErrorDetail } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Scale, CheckCircle2, ArrowUpRight, ArrowDownRight, Loader2, Wand2 } from "lucide-react";
import { toast } from "sonner";

export default function Reconciliation() {
  const { data: summary } = useQuery({ queryKey: ["recon-summary"], queryFn: async () => (await api.get("/reconciliation/summary")).data });
  return (
    <div className="p-6 md:p-10 max-w-6xl fade-up">
      <header className="mb-8">
        <p className="text-xs uppercase tracking-[0.2em] font-semibold text-muted-foreground mb-2">Bookkeeping</p>
        <h1 className="font-heading text-3xl sm:text-4xl font-light tracking-tight">Bank Reconciliation</h1>
        <p className="text-sm text-muted-foreground mt-2">Post your bank transactions into the double-entry ledger.</p>
      </header>

      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-8">
          <Stat label="Reconciled" value={summary.reconciled} testid="recon-reconciled" />
          <Stat label="To reconcile" value={summary.unreconciled} testid="recon-unreconciled" />
          <Stat label="Unreconciled amount" value={currency(summary.unreconciled_amount)} testid="recon-amount" />
        </div>
      )}

      <Tabs defaultValue="todo">
        <TabsList>
          <TabsTrigger value="todo" data-testid="tab-todo">To reconcile</TabsTrigger>
          <TabsTrigger value="done" data-testid="tab-done">Reconciled</TabsTrigger>
        </TabsList>
        <TabsContent value="todo"><ReconList status="unreconciled" /></TabsContent>
        <TabsContent value="done"><ReconList status="reconciled" /></TabsContent>
      </Tabs>
    </div>
  );
}

const Stat = ({ label, value, testid }) => (
  <Card className="p-5" data-testid={testid}>
    <p className="text-sm text-muted-foreground">{label}</p>
    <p className="font-heading text-2xl font-semibold mt-2">{value}</p>
  </Card>
);

function ReconList({ status }) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState({});
  const { data, isLoading } = useQuery({
    queryKey: ["recon", status],
    queryFn: async () => (await api.get("/reconciliation/transactions", { params: { status } })).data,
  });

  const txns = data?.transactions || [];
  const accounts = data?.accounts || [];

  useEffect(() => {
    if (status === "unreconciled" && txns.length) {
      setSelected((prev) => {
        const next = { ...prev };
        txns.forEach((t) => { if (!next[t.id]) next[t.id] = t.suggested_account_id; });
        return next;
      });
    }
  }, [data]); // eslint-disable-line

  const invalidate = () => { qc.invalidateQueries({ queryKey: ["recon"] }); qc.invalidateQueries({ queryKey: ["recon-summary"] }); qc.invalidateQueries({ queryKey: ["summary"] }); };

  const postMut = useMutation({
    mutationFn: async ({ transaction_id, account_id }) => (await api.post("/reconciliation/post", { transaction_id, account_id })).data,
    onSuccess: () => { invalidate(); toast.success("Posted to ledger"); },
    onError: (e) => toast.error(formatApiErrorDetail(e.response?.data?.detail)),
  });

  const bulkMut = useMutation({
    mutationFn: async () => (await api.post("/reconciliation/post-bulk", {
      items: txns.map((t) => ({ transaction_id: t.id, account_id: selected[t.id] })).filter((i) => i.account_id),
    })).data,
    onSuccess: (d) => { invalidate(); toast.success(`Posted ${d.posted} transactions`); },
    onError: (e) => toast.error(formatApiErrorDetail(e.response?.data?.detail)),
  });

  const accName = (id) => { const a = accounts.find((x) => x.id === id); return a ? `${a.code} · ${a.name}` : "—"; };

  if (isLoading) return <div className="mt-4 space-y-3">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12" />)}</div>;
  if (!txns.length) return (
    <Card className="p-12 text-center mt-4" data-testid={`recon-empty-${status}`}>
      <CheckCircle2 className="h-10 w-10 text-primary mx-auto mb-3" />
      <p className="text-muted-foreground">{status === "unreconciled" ? "Everything is reconciled. 🎉" : "Nothing reconciled yet."}</p>
    </Card>
  );

  return (
    <div className="mt-4">
      {status === "unreconciled" && (
        <div className="flex justify-end mb-3">
          <Button onClick={() => bulkMut.mutate()} disabled={bulkMut.isPending} className="gap-2" data-testid="post-all-btn">
            {bulkMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />} Post all suggested
          </Button>
        </div>
      )}
      <Card className="overflow-hidden" data-testid={`recon-table-${status}`}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead><TableHead>Description</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>{status === "unreconciled" ? "Post to account" : "Account"}</TableHead>
              {status === "unreconciled" && <TableHead className="text-right">Action</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {txns.map((t) => (
              <TableRow key={t.id} data-testid={`recon-row-${t.id}`}>
                <TableCell className="text-muted-foreground text-sm whitespace-nowrap">{(t.date || "").slice(0, 10)}</TableCell>
                <TableCell className="max-w-xs truncate">
                  <span className="font-medium">{t.description}</span>
                  <Badge variant="secondary" className="ml-2 font-normal text-[10px]">{t.category}</Badge>
                </TableCell>
                <TableCell className={`text-right tabular-nums ${t.type === "income" ? "text-primary" : ""}`}>
                  <span className="inline-flex items-center gap-1 justify-end">
                    {t.type === "income" ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                    {currency(t.amount)}
                  </span>
                </TableCell>
                {status === "unreconciled" ? (
                  <>
                    <TableCell>
                      <Select value={selected[t.id] || ""} onValueChange={(v) => setSelected({ ...selected, [t.id]: v })}>
                        <SelectTrigger className="w-56" data-testid={`recon-account-${t.id}`}><SelectValue placeholder="Choose account" /></SelectTrigger>
                        <SelectContent>
                          {accounts.filter((a) => a.type === (t.type === "income" ? "income" : "expense")).map((a) => (
                            <SelectItem key={a.id} value={a.id}>{a.code} · {a.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" disabled={!selected[t.id] || postMut.isPending}
                        onClick={() => postMut.mutate({ transaction_id: t.id, account_id: selected[t.id] })}
                        data-testid={`post-recon-${t.id}`}>Post</Button>
                    </TableCell>
                  </>
                ) : (
                  <TableCell className="text-sm text-muted-foreground">Posted to ledger</TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
