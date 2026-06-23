import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api, { currency, formatApiErrorDetail } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { Plus, Trash2, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { toast } from "sonner";

export default function Transactions() {
  const qc = useQueryClient();
  const [typeFilter, setTypeFilter] = useState("all");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    description: "", category: "", type: "expense", amount: "",
  });

  const { data, isLoading } = useQuery({
    queryKey: ["transactions", typeFilter],
    queryFn: async () => {
      const params = typeFilter === "all" ? {} : { type: typeFilter };
      return (await api.get("/transactions", { params })).data;
    },
  });

  const addMut = useMutation({
    mutationFn: async (payload) => (await api.post("/transactions", payload)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["summary"] });
      toast.success("Transaction added");
      setOpen(false);
      setForm({ ...form, description: "", category: "", amount: "" });
    },
    onError: (e) => toast.error(formatApiErrorDetail(e.response?.data?.detail)),
  });

  const delMut = useMutation({
    mutationFn: async (id) => (await api.delete(`/transactions/${id}`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["summary"] });
      toast.success("Deleted");
    },
  });

  const submit = (e) => {
    e.preventDefault();
    addMut.mutate({ ...form, amount: parseFloat(form.amount) });
  };

  const txns = data?.transactions || [];

  return (
    <div className="p-6 md:p-10 max-w-6xl fade-up">
      <header className="flex flex-wrap items-end justify-between gap-4 mb-8">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] font-semibold text-muted-foreground mb-2">Ledger</p>
          <h1 className="font-heading text-3xl sm:text-4xl font-light tracking-tight">Transactions</h1>
        </div>
        <div className="flex items-center gap-3">
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-36" data-testid="type-filter"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              <SelectItem value="income">Income</SelectItem>
              <SelectItem value="expense">Expense</SelectItem>
            </SelectContent>
          </Select>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2" data-testid="add-transaction-btn"><Plus className="h-4 w-4" /> Add</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Add transaction</DialogTitle></DialogHeader>
              <form onSubmit={submit} className="space-y-4" data-testid="add-transaction-form">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Date</Label>
                    <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required className="mt-1.5" data-testid="txn-date" />
                  </div>
                  <div>
                    <Label>Type</Label>
                    <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                      <SelectTrigger className="mt-1.5" data-testid="txn-type"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="income">Income</SelectItem>
                        <SelectItem value="expense">Expense</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <Label>Description</Label>
                  <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} required className="mt-1.5" data-testid="txn-description" placeholder="e.g. Office rent" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Category</Label>
                    <Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="mt-1.5" data-testid="txn-category" placeholder="Rent" />
                  </div>
                  <div>
                    <Label>Amount</Label>
                    <Input type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required className="mt-1.5" data-testid="txn-amount" placeholder="0.00" />
                  </div>
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={addMut.isPending} data-testid="save-transaction-btn">Save</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </header>

      <Card className="overflow-hidden" data-testid="transactions-table">
        {isLoading ? (
          <div className="p-6 space-y-3">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
        ) : txns.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground" data-testid="transactions-empty">
            No transactions yet. Add one or import a worksheet.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {txns.map((t) => (
                <TableRow key={t.id} data-testid={`txn-row-${t.id}`}>
                  <TableCell className="text-muted-foreground text-sm whitespace-nowrap">{(t.date || "").slice(0, 10)}</TableCell>
                  <TableCell className="font-medium max-w-xs truncate">{t.description}</TableCell>
                  <TableCell><Badge variant="secondary" className="font-normal">{t.category}</Badge></TableCell>
                  <TableCell>
                    <span className={`inline-flex items-center gap-1 text-sm ${t.type === "income" ? "text-primary" : "text-destructive"}`}>
                      {t.type === "income" ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
                      {t.type}
                    </span>
                  </TableCell>
                  <TableCell className={`text-right font-medium tabular-nums ${t.type === "income" ? "text-primary" : ""}`}>
                    {t.type === "income" ? "+" : "-"}{currency(t.amount)}
                  </TableCell>
                  <TableCell>
                    <button onClick={() => delMut.mutate(t.id)} className="text-muted-foreground hover:text-destructive transition-colors" data-testid={`delete-txn-${t.id}`}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
