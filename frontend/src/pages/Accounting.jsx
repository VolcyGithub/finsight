import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api, { currency, formatApiErrorDetail } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Plus, Trash2, BookOpen, Lock, Scale } from "lucide-react";
import { toast } from "sonner";

const TYPE_ORDER = ["asset", "liability", "equity", "income", "expense"];
const TYPE_LABEL = { asset: "Assets", liability: "Liabilities", equity: "Equity", income: "Income", expense: "Expenses" };
const typeBadge = {
  asset: "bg-primary/10 text-primary", liability: "bg-destructive/10 text-destructive",
  equity: "bg-accent/15 text-accent", income: "bg-primary/10 text-primary",
  expense: "bg-[hsl(16_42%_58%/0.12)] text-[hsl(16_42%_45%)]",
};

export default function Accounting() {
  return (
    <div className="p-6 md:p-10 max-w-5xl fade-up">
      <header className="mb-8">
        <p className="text-xs uppercase tracking-[0.2em] font-semibold text-muted-foreground mb-2">General Ledger</p>
        <h1 className="font-heading text-3xl sm:text-4xl font-light tracking-tight">Accounting</h1>
        <p className="text-sm text-muted-foreground mt-2">Double-entry chart of accounts and journal.</p>
      </header>
      <Tabs defaultValue="accounts">
        <TabsList>
          <TabsTrigger value="accounts" data-testid="tab-coa">Chart of Accounts</TabsTrigger>
          <TabsTrigger value="journal" data-testid="tab-journal">Journal</TabsTrigger>
        </TabsList>
        <TabsContent value="accounts"><ChartOfAccounts /></TabsContent>
        <TabsContent value="journal"><Journal /></TabsContent>
      </Tabs>
    </div>
  );
}

function ChartOfAccounts() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ code: "", name: "", type: "expense" });
  const { data, isLoading } = useQuery({ queryKey: ["accounts"], queryFn: async () => (await api.get("/accounts")).data });

  const addMut = useMutation({
    mutationFn: async () => (await api.post("/accounts", form)).data,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["accounts"] }); toast.success("Account added"); setOpen(false); setForm({ code: "", name: "", type: "expense" }); },
    onError: (e) => toast.error(formatApiErrorDetail(e.response?.data?.detail)),
  });
  const delMut = useMutation({
    mutationFn: async (id) => (await api.delete(`/accounts/${id}`)).data,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["accounts"] }); toast.success("Account deleted"); },
    onError: (e) => toast.error(formatApiErrorDetail(e.response?.data?.detail)),
  });

  const accounts = data?.accounts || [];

  return (
    <div className="mt-4">
      <div className="flex justify-end mb-4">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button className="gap-2" data-testid="add-account-btn"><Plus className="h-4 w-4" /> Add account</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add account</DialogTitle><DialogDescription>Create a new ledger account.</DialogDescription></DialogHeader>
            <form onSubmit={(e) => { e.preventDefault(); addMut.mutate(); }} className="space-y-4" data-testid="account-form">
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Code</Label><Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} required className="mt-1.5" placeholder="6700" data-testid="account-code" /></div>
                <div><Label>Type</Label>
                  <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                    <SelectTrigger className="mt-1.5" data-testid="account-type"><SelectValue /></SelectTrigger>
                    <SelectContent>{TYPE_ORDER.map((t) => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <div><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required className="mt-1.5" placeholder="Bank Fees" data-testid="account-name" /></div>
              <DialogFooter><Button type="submit" disabled={addMut.isPending} data-testid="save-account-btn">Save</Button></DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? <div className="space-y-3">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12" />)}</div> : (
        <div className="space-y-6" data-testid="coa-list">
          {TYPE_ORDER.map((t) => {
            const group = accounts.filter((a) => a.type === t);
            if (!group.length) return null;
            return (
              <div key={t}>
                <h3 className="font-heading text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-2">{TYPE_LABEL[t]}</h3>
                <Card className="divide-y divide-border">
                  {group.map((a) => (
                    <div key={a.id} className="flex items-center justify-between px-4 py-3" data-testid={`account-${a.code}`}>
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-sm text-muted-foreground w-14">{a.code}</span>
                        <span className="font-medium text-sm">{a.name}</span>
                        {a.system && <Badge variant="secondary" className="font-normal text-[10px] gap-1"><Lock className="h-2.5 w-2.5" /> system</Badge>}
                      </div>
                      {!a.system && (
                        <button onClick={() => delMut.mutate(a.id)} className="text-muted-foreground hover:text-destructive" data-testid={`delete-account-${a.code}`}><Trash2 className="h-4 w-4" /></button>
                      )}
                    </div>
                  ))}
                </Card>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Journal() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [memo, setMemo] = useState("");
  const [lines, setLines] = useState([{ account_id: "", debit: "", credit: "" }, { account_id: "", debit: "", credit: "" }]);

  const { data: jData, isLoading } = useQuery({ queryKey: ["journal"], queryFn: async () => (await api.get("/journal")).data });
  const { data: aData } = useQuery({ queryKey: ["accounts"], queryFn: async () => (await api.get("/accounts")).data });
  const accounts = aData?.accounts || [];

  const totalDebit = lines.reduce((s, l) => s + (parseFloat(l.debit) || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (parseFloat(l.credit) || 0), 0);
  const balanced = totalDebit > 0 && Math.abs(totalDebit - totalCredit) < 0.01;

  const addMut = useMutation({
    mutationFn: async () => (await api.post("/journal", {
      date, memo,
      lines: lines.filter((l) => l.account_id && (parseFloat(l.debit) || parseFloat(l.credit)))
        .map((l) => ({ account_id: l.account_id, debit: parseFloat(l.debit) || 0, credit: parseFloat(l.credit) || 0 })),
    })).data,
    onSuccess: () => { qc.invalidateQueries(); toast.success("Journal entry posted"); setOpen(false); setLines([{ account_id: "", debit: "", credit: "" }, { account_id: "", debit: "", credit: "" }]); setMemo(""); },
    onError: (e) => toast.error(formatApiErrorDetail(e.response?.data?.detail)),
  });

  const updateLine = (idx, key, val) => setLines(lines.map((l, i) => i === idx ? { ...l, [key]: val } : l));
  const entries = jData?.entries || [];

  return (
    <div className="mt-4">
      <div className="flex justify-end mb-4">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button className="gap-2" data-testid="add-journal-btn"><Plus className="h-4 w-4" /> New entry</Button></DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>New journal entry</DialogTitle><DialogDescription>Debits must equal credits.</DialogDescription></DialogHeader>
            <form onSubmit={(e) => { e.preventDefault(); addMut.mutate(); }} className="space-y-4" data-testid="journal-form">
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Date</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1.5" data-testid="journal-date" /></div>
                <div><Label>Memo</Label><Input value={memo} onChange={(e) => setMemo(e.target.value)} className="mt-1.5" placeholder="Description" data-testid="journal-memo" /></div>
              </div>
              <div className="space-y-2">
                {lines.map((l, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                    <Select value={l.account_id} onValueChange={(v) => updateLine(idx, "account_id", v)}>
                      <SelectTrigger className="col-span-6" data-testid={`jline-account-${idx}`}><SelectValue placeholder="Account" /></SelectTrigger>
                      <SelectContent>{accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.code} · {a.name}</SelectItem>)}</SelectContent>
                    </Select>
                    <Input className="col-span-3" type="number" step="0.01" placeholder="Debit" value={l.debit} onChange={(e) => updateLine(idx, "debit", e.target.value)} data-testid={`jline-debit-${idx}`} />
                    <Input className="col-span-2" type="number" step="0.01" placeholder="Credit" value={l.credit} onChange={(e) => updateLine(idx, "credit", e.target.value)} data-testid={`jline-credit-${idx}`} />
                    <button type="button" className="col-span-1 text-muted-foreground hover:text-destructive" onClick={() => setLines(lines.filter((_, i) => i !== idx))} disabled={lines.length <= 2}><Trash2 className="h-4 w-4" /></button>
                  </div>
                ))}
              </div>
              <Button type="button" variant="ghost" size="sm" className="gap-1" onClick={() => setLines([...lines, { account_id: "", debit: "", credit: "" }])} data-testid="add-journal-line"><Plus className="h-3.5 w-3.5" /> Add line</Button>
              <div className={`flex items-center justify-between text-sm rounded-md px-3 py-2 ${balanced ? "bg-primary/10 text-primary" : "bg-secondary text-muted-foreground"}`} data-testid="journal-balance">
                <span className="flex items-center gap-1.5"><Scale className="h-4 w-4" /> {balanced ? "Balanced" : "Not balanced"}</span>
                <span className="tabular-nums">Dr {currency(totalDebit)} · Cr {currency(totalCredit)}</span>
              </div>
              <DialogFooter><Button type="submit" disabled={!balanced || addMut.isPending} data-testid="save-journal-btn">Post entry</Button></DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? <div className="space-y-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-16" />)}</div> :
        entries.length === 0 ? (
          <Card className="p-12 text-center" data-testid="journal-empty"><BookOpen className="h-10 w-10 text-muted-foreground mx-auto mb-3" /><p className="text-muted-foreground">No journal entries yet.</p></Card>
        ) : (
          <div className="space-y-3" data-testid="journal-list">
            {entries.map((e) => (
              <Card key={e.id} className="p-4" data-testid={`journal-entry-${e.id}`}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{e.date?.slice(0, 10)}</span>
                    <span className="text-sm text-muted-foreground">{e.memo}</span>
                  </div>
                  <Badge variant="secondary" className="font-normal capitalize text-xs">{e.source}</Badge>
                </div>
                <div className="space-y-1">
                  {e.lines.map((l, i) => (
                    <div key={i} className="grid grid-cols-12 text-sm">
                      <span className="col-span-8 text-muted-foreground"><span className="font-mono text-xs mr-2">{l.account_code}</span>{l.account_name}</span>
                      <span className="col-span-2 text-right tabular-nums">{l.debit ? currency(l.debit) : ""}</span>
                      <span className="col-span-2 text-right tabular-nums text-muted-foreground">{l.credit ? currency(l.credit) : ""}</span>
                    </div>
                  ))}
                </div>
              </Card>
            ))}
          </div>
        )}
    </div>
  );
}
