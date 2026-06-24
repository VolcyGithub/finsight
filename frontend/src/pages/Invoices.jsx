import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import api, { currency, formatApiErrorDetail } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Plus, Trash2, FileText, Send, CheckCircle2, CreditCard, Loader2 } from "lucide-react";
import { toast } from "sonner";

const statusStyle = {
  draft: "bg-secondary text-secondary-foreground",
  sent: "bg-accent/15 text-accent border border-accent/30",
  paid: "bg-primary/15 text-primary border border-primary/30",
  void: "bg-muted text-muted-foreground",
};

export default function Invoices() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState(false);
  const polled = useRef(false);

  const { data, isLoading } = useQuery({
    queryKey: ["invoices"],
    queryFn: async () => (await api.get("/invoices")).data,
  });
  const { data: contacts } = useQuery({
    queryKey: ["contacts", "customer"],
    queryFn: async () => (await api.get("/contacts", { params: { type: "customer" } })).data,
  });

  useEffect(() => {
    const sid = params.get("session_id");
    if (sid && !polled.current) {
      polled.current = true;
      pollStatus(sid, 0);
    }
  }, []); // eslint-disable-line

  const pollStatus = async (sid, attempt) => {
    if (attempt >= 6) { toast.message("Still processing payment — refresh shortly."); return; }
    try {
      const { data: s } = await api.get(`/payments/status/${sid}`);
      if (s.payment_status === "paid") {
        toast.success("Payment received — invoice marked paid");
        qc.invalidateQueries();
        params.delete("session_id"); setParams(params, { replace: true });
        return;
      }
      if (s.status === "expired") { toast.error("Payment session expired"); params.delete("session_id"); setParams(params, { replace: true }); return; }
      setTimeout(() => pollStatus(sid, attempt + 1), 2000);
    } catch {
      setTimeout(() => pollStatus(sid, attempt + 1), 2000);
    }
  };

  const sendMut = useMutation({
    mutationFn: async (id) => (await api.post(`/invoices/${id}/send`)).data,
    onSuccess: () => { qc.invalidateQueries(); toast.success("Invoice sent"); },
  });
  const paidMut = useMutation({
    mutationFn: async (id) => (await api.post(`/invoices/${id}/mark-paid`)).data,
    onSuccess: () => { qc.invalidateQueries(); toast.success("Marked as paid"); },
    onError: (e) => toast.error(formatApiErrorDetail(e.response?.data?.detail)),
  });
  const payMut = useMutation({
    mutationFn: async (id) => (await api.post(`/invoices/${id}/checkout`, { origin_url: window.location.origin })).data,
    onSuccess: (d) => { window.location.href = d.url; },
    onError: (e) => toast.error(formatApiErrorDetail(e.response?.data?.detail)),
  });

  const invoices = data?.invoices || [];
  const customers = contacts?.contacts || [];

  return (
    <div className="p-6 md:p-10 max-w-6xl fade-up">
      <header className="flex flex-wrap items-end justify-between gap-4 mb-8">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] font-semibold text-muted-foreground mb-2">Sales</p>
          <h1 className="font-heading text-3xl sm:text-4xl font-light tracking-tight">Invoices</h1>
        </div>
        <CreateInvoiceDialog open={open} setOpen={setOpen} customers={customers}
          onCreated={() => { qc.invalidateQueries(); setOpen(false); }} />
      </header>

      <Card className="overflow-hidden" data-testid="invoices-table">
        {isLoading ? (
          <div className="p-6 space-y-3">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
        ) : invoices.length === 0 ? (
          <div className="p-12 text-center" data-testid="invoices-empty">
            <FileText className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">No invoices yet. Create your first invoice.</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Number</TableHead><TableHead>Customer</TableHead>
                <TableHead>Issue</TableHead><TableHead>Due</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.map((inv) => (
                <TableRow key={inv.id} data-testid={`invoice-row-${inv.number}`}>
                  <TableCell className="font-medium">{inv.number}</TableCell>
                  <TableCell>{inv.customer_name}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{inv.issue_date}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{inv.due_date}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{currency(inv.total)}</TableCell>
                  <TableCell><Badge className={`capitalize font-normal ${statusStyle[inv.status]}`}>{inv.status}</Badge></TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      {inv.status === "draft" && (
                        <Button size="sm" variant="ghost" className="gap-1" onClick={() => sendMut.mutate(inv.id)} data-testid={`send-invoice-${inv.number}`}>
                          <Send className="h-3.5 w-3.5" /> Send
                        </Button>
                      )}
                      {inv.status !== "paid" && (
                        <>
                          <Button size="sm" variant="outline" className="gap-1" disabled={payMut.isPending} onClick={() => payMut.mutate(inv.id)} data-testid={`pay-invoice-${inv.number}`}>
                            <CreditCard className="h-3.5 w-3.5" /> Pay online
                          </Button>
                          {inv.status === "sent" && (
                            <Button size="sm" variant="ghost" className="gap-1" onClick={() => paidMut.mutate(inv.id)} data-testid={`markpaid-invoice-${inv.number}`}>
                              <CheckCircle2 className="h-3.5 w-3.5" /> Mark paid
                            </Button>
                          )}
                        </>
                      )}
                      {inv.status === "paid" && <span className="text-sm text-primary flex items-center gap-1"><CheckCircle2 className="h-4 w-4" /> Paid</span>}
                    </div>
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

function CreateInvoiceDialog({ open, setOpen, customers, onCreated }) {
  const today = new Date().toISOString().slice(0, 10);
  const [customerId, setCustomerId] = useState("");
  const [issueDate, setIssueDate] = useState(today);
  const [dueDate, setDueDate] = useState(today);
  const [taxRate, setTaxRate] = useState("0");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState([{ description: "", quantity: "1", unit_price: "" }]);

  const subtotal = items.reduce((s, i) => s + (parseFloat(i.quantity) || 0) * (parseFloat(i.unit_price) || 0), 0);
  const tax = subtotal * (parseFloat(taxRate) || 0) / 100;
  const total = subtotal + tax;

  const createMut = useMutation({
    mutationFn: async () => (await api.post("/invoices", {
      customer_id: customerId, issue_date: issueDate, due_date: dueDate,
      tax_rate: parseFloat(taxRate) || 0, notes, status: "sent",
      line_items: items.map((i) => ({ description: i.description, quantity: parseFloat(i.quantity) || 0, unit_price: parseFloat(i.unit_price) || 0 })),
    })).data,
    onSuccess: () => { toast.success("Invoice created"); onCreated(); resetForm(); },
    onError: (e) => toast.error(formatApiErrorDetail(e.response?.data?.detail)),
  });

  const resetForm = () => { setCustomerId(""); setItems([{ description: "", quantity: "1", unit_price: "" }]); setTaxRate("0"); setNotes(""); };
  const updateItem = (idx, key, val) => setItems(items.map((it, i) => i === idx ? { ...it, [key]: val } : it));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2" data-testid="create-invoice-btn"><Plus className="h-4 w-4" /> New invoice</Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create invoice</DialogTitle>
          <DialogDescription>Posts a balanced journal entry (A/R, Income, Tax) automatically.</DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); createMut.mutate(); }} className="space-y-4" data-testid="invoice-form">
          <div className="grid sm:grid-cols-3 gap-3">
            <div className="sm:col-span-1">
              <Label>Customer</Label>
              <Select value={customerId} onValueChange={setCustomerId} required>
                <SelectTrigger className="mt-1.5" data-testid="invoice-customer"><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  {customers.length === 0 ? <div className="px-3 py-2 text-sm text-muted-foreground">Add a customer first</div> :
                    customers.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Issue date</Label><Input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} className="mt-1.5" data-testid="invoice-issue-date" /></div>
            <div><Label>Due date</Label><Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="mt-1.5" data-testid="invoice-due-date" /></div>
          </div>

          <div>
            <Label>Line items</Label>
            <div className="space-y-2 mt-1.5">
              {items.map((it, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                  <Input className="col-span-6" placeholder="Description" value={it.description} onChange={(e) => updateItem(idx, "description", e.target.value)} required data-testid={`item-desc-${idx}`} />
                  <Input className="col-span-2" type="number" step="0.01" placeholder="Qty" value={it.quantity} onChange={(e) => updateItem(idx, "quantity", e.target.value)} data-testid={`item-qty-${idx}`} />
                  <Input className="col-span-3" type="number" step="0.01" placeholder="Unit price" value={it.unit_price} onChange={(e) => updateItem(idx, "unit_price", e.target.value)} data-testid={`item-price-${idx}`} />
                  <button type="button" className="col-span-1 text-muted-foreground hover:text-destructive" onClick={() => setItems(items.filter((_, i) => i !== idx))} disabled={items.length === 1}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
            <Button type="button" variant="ghost" size="sm" className="gap-1 mt-2" onClick={() => setItems([...items, { description: "", quantity: "1", unit_price: "" }])} data-testid="add-line-item">
              <Plus className="h-3.5 w-3.5" /> Add line
            </Button>
          </div>

          <div className="grid sm:grid-cols-2 gap-3 items-end">
            <div><Label>Tax rate (%)</Label><Input type="number" step="0.01" value={taxRate} onChange={(e) => setTaxRate(e.target.value)} className="mt-1.5" data-testid="invoice-tax-rate" /></div>
            <div className="text-right text-sm space-y-1">
              <p className="text-muted-foreground">Subtotal: <span className="font-medium text-foreground">{currency(subtotal)}</span></p>
              <p className="text-muted-foreground">Tax: <span className="font-medium text-foreground">{currency(tax)}</span></p>
              <p className="font-heading text-lg font-semibold" data-testid="invoice-total-preview">Total: {currency(total)}</p>
            </div>
          </div>
          <Textarea placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} data-testid="invoice-notes" />
          <DialogFooter>
            <Button type="submit" disabled={createMut.isPending || !customerId} data-testid="save-invoice-btn">
              {createMut.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />} Create & send
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
