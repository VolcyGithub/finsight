import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import api, { formatApiErrorDetail } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { ShieldCheck, Lock, Database, Trash2, User } from "lucide-react";
import { toast } from "sonner";

export default function Settings() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const clearData = async () => {
    try {
      await api.delete("/data/clear");
      qc.invalidateQueries();
      toast.success("All financial data cleared");
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail));
    }
  };

  return (
    <div className="p-6 md:p-10 max-w-3xl fade-up">
      <header className="mb-8">
        <p className="text-xs uppercase tracking-[0.2em] font-semibold text-muted-foreground mb-2">Account</p>
        <h1 className="font-heading text-3xl sm:text-4xl font-light tracking-tight">Settings</h1>
      </header>

      <Card className="p-6 mb-6" data-testid="profile-card">
        <div className="flex items-center gap-3 mb-4">
          <User className="h-5 w-5 text-primary" />
          <h2 className="font-heading text-lg font-medium">Profile</h2>
        </div>
        <div className="grid sm:grid-cols-2 gap-4 text-sm">
          <div><p className="text-muted-foreground">Name</p><p className="font-medium mt-0.5">{user?.name}</p></div>
          <div><p className="text-muted-foreground">Email</p><p className="font-medium mt-0.5">{user?.email}</p></div>
          <div><p className="text-muted-foreground">Role</p><p className="font-medium mt-0.5 capitalize">{user?.role}</p></div>
        </div>
      </Card>

      <Card className="p-6 mb-6 bg-accent/5 border-accent/30" data-testid="privacy-card">
        <div className="flex items-center gap-3 mb-4">
          <ShieldCheck className="h-5 w-5 text-primary" />
          <h2 className="font-heading text-lg font-medium">Privacy & Security</h2>
        </div>
        <div className="space-y-3 text-sm">
          <Row icon={Lock} title="Field-level encryption" desc="Amounts and descriptions are encrypted (Fernet/AES) before storage." />
          <Row icon={Database} title="Isolated data" desc="Your records are scoped to your account and never shared." />
          <Row icon={ShieldCheck} title="Secure auth" desc="Passwords hashed with bcrypt; sessions via signed JWT cookies." />
        </div>
      </Card>

      <Card className="p-6 border-destructive/30" data-testid="danger-card">
        <h2 className="font-heading text-lg font-medium mb-1 text-destructive">Danger zone</h2>
        <p className="text-sm text-muted-foreground mb-4">Permanently delete all imported worksheets, transactions, alerts and AI reports.</p>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" className="gap-2" data-testid="clear-data-btn"><Trash2 className="h-4 w-4" /> Clear all data</Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete all financial data?</AlertDialogTitle>
              <AlertDialogDescription>This cannot be undone. All transactions, imports, alerts and reports will be removed.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel data-testid="cancel-clear">Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={clearData} data-testid="confirm-clear">Delete everything</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </Card>
    </div>
  );
}

const Row = ({ icon: Icon, title, desc }) => (
  <div className="flex items-start gap-3">
    <Icon className="h-4 w-4 text-primary mt-0.5 shrink-0" />
    <div><p className="font-medium">{title}</p><p className="text-muted-foreground">{desc}</p></div>
  </div>
);
