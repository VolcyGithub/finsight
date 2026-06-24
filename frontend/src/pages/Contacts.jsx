import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api, { formatApiErrorDetail } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Plus, Trash2, Building2, Mail, Phone, User } from "lucide-react";
import { toast } from "sonner";

export default function Contacts() {
  const [tab, setTab] = useState("customer");
  return (
    <div className="p-6 md:p-10 max-w-4xl fade-up">
      <header className="mb-8">
        <p className="text-xs uppercase tracking-[0.2em] font-semibold text-muted-foreground mb-2">Directory</p>
        <h1 className="font-heading text-3xl sm:text-4xl font-light tracking-tight">Customers & Vendors</h1>
      </header>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList data-testid="contacts-tabs">
          <TabsTrigger value="customer" data-testid="tab-customers">Customers</TabsTrigger>
          <TabsTrigger value="vendor" data-testid="tab-vendors">Vendors</TabsTrigger>
        </TabsList>
        <TabsContent value="customer"><ContactList type="customer" /></TabsContent>
        <TabsContent value="vendor"><ContactList type="vendor" /></TabsContent>
      </Tabs>
    </div>
  );
}

function ContactList({ type }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", phone: "", address: "" });

  const { data, isLoading } = useQuery({
    queryKey: ["contacts", type],
    queryFn: async () => (await api.get("/contacts", { params: { type } })).data,
  });

  const addMut = useMutation({
    mutationFn: async () => (await api.post("/contacts", { type, ...form })).data,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["contacts"] }); toast.success(`${type === "customer" ? "Customer" : "Vendor"} added`); setOpen(false); setForm({ name: "", email: "", phone: "", address: "" }); },
    onError: (e) => toast.error(formatApiErrorDetail(e.response?.data?.detail)),
  });
  const delMut = useMutation({
    mutationFn: async (id) => (await api.delete(`/contacts/${id}`)).data,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["contacts"] }); toast.success("Removed"); },
  });

  const contacts = data?.contacts || [];

  return (
    <div className="mt-4">
      <div className="flex justify-end mb-4">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2" data-testid={`add-${type}-btn`}><Plus className="h-4 w-4" /> Add {type}</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add {type}</DialogTitle>
              <DialogDescription>Create a {type} record for invoicing and reporting.</DialogDescription>
            </DialogHeader>
            <form onSubmit={(e) => { e.preventDefault(); addMut.mutate(); }} className="space-y-4" data-testid={`${type}-form`}>
              <div><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required className="mt-1.5" data-testid={`${type}-name`} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Email</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="mt-1.5" data-testid={`${type}-email`} /></div>
                <div><Label>Phone</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="mt-1.5" data-testid={`${type}-phone`} /></div>
              </div>
              <div><Label>Address</Label><Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="mt-1.5" data-testid={`${type}-address`} /></div>
              <DialogFooter><Button type="submit" disabled={addMut.isPending} data-testid={`save-${type}-btn`}>Save</Button></DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="grid sm:grid-cols-2 gap-4">{[...Array(2)].map((_, i) => <Skeleton key={i} className="h-28" />)}</div>
      ) : contacts.length === 0 ? (
        <Card className="p-12 text-center" data-testid={`${type}-empty`}>
          <Building2 className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground">No {type}s yet.</p>
        </Card>
      ) : (
        <div className="grid sm:grid-cols-2 gap-4" data-testid={`${type}-list`}>
          {contacts.map((c) => (
            <Card key={c.id} className="p-5 transition-transform duration-200 hover:-translate-y-1 hover:shadow-sm" data-testid={`contact-${c.id}`}>
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-secondary flex items-center justify-center">
                    <User className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-heading font-medium">{c.name}</p>
                    {c.email && <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5"><Mail className="h-3 w-3" /> {c.email}</p>}
                    {c.phone && <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5"><Phone className="h-3 w-3" /> {c.phone}</p>}
                  </div>
                </div>
                <button onClick={() => delMut.mutate(c.id)} className="text-muted-foreground hover:text-destructive" data-testid={`delete-contact-${c.id}`}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
