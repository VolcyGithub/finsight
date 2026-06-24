import { useQuery } from "@tanstack/react-query";
import api, { currency } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CheckCircle2, AlertCircle } from "lucide-react";

export default function Reports() {
  return (
    <div className="p-6 md:p-10 max-w-4xl fade-up">
      <header className="mb-8">
        <p className="text-xs uppercase tracking-[0.2em] font-semibold text-muted-foreground mb-2">Financial Statements</p>
        <h1 className="font-heading text-3xl sm:text-4xl font-light tracking-tight">Reports</h1>
        <p className="text-sm text-muted-foreground mt-2">Generated from your double-entry ledger.</p>
      </header>
      <Tabs defaultValue="pl">
        <TabsList>
          <TabsTrigger value="pl" data-testid="tab-pl">Profit & Loss</TabsTrigger>
          <TabsTrigger value="bs" data-testid="tab-bs">Balance Sheet</TabsTrigger>
          <TabsTrigger value="tb" data-testid="tab-tb">Trial Balance</TabsTrigger>
        </TabsList>
        <TabsContent value="pl"><ProfitLoss /></TabsContent>
        <TabsContent value="bs"><BalanceSheet /></TabsContent>
        <TabsContent value="tb"><TrialBalance /></TabsContent>
      </Tabs>
    </div>
  );
}

const Loader = () => <div className="mt-4 space-y-3">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10" />)}</div>;

const LineRow = ({ name, code, amount, bold }) => (
  <div className={`flex items-center justify-between py-2 text-sm ${bold ? "font-semibold" : ""}`}>
    <span className={bold ? "" : "text-muted-foreground"}>{code && <span className="font-mono text-xs mr-2">{code}</span>}{name}</span>
    <span className="tabular-nums">{currency(amount)}</span>
  </div>
);

function ProfitLoss() {
  const { data, isLoading } = useQuery({ queryKey: ["pl"], queryFn: async () => (await api.get("/reports/profit-loss")).data });
  if (isLoading) return <Loader />;
  return (
    <Card className="p-6 mt-4" data-testid="report-pl">
      <h3 className="font-heading text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-1">Income</h3>
      <div className="divide-y divide-border">
        {data.income.length ? data.income.map((r) => <LineRow key={r.code} {...r} amount={r.balance} />) : <p className="text-sm text-muted-foreground py-2">No income recorded.</p>}
      </div>
      <div className="flex justify-between border-t border-border mt-1 pt-2 font-medium text-sm"><span>Total income</span><span className="tabular-nums text-primary" data-testid="pl-total-income">{currency(data.total_income)}</span></div>

      <h3 className="font-heading text-sm font-semibold uppercase tracking-wide text-muted-foreground mt-6 mb-1">Expenses</h3>
      <div className="divide-y divide-border">
        {data.expense.length ? data.expense.map((r) => <LineRow key={r.code} {...r} amount={r.balance} />) : <p className="text-sm text-muted-foreground py-2">No expenses recorded.</p>}
      </div>
      <div className="flex justify-between border-t border-border mt-1 pt-2 font-medium text-sm"><span>Total expenses</span><span className="tabular-nums">{currency(data.total_expense)}</span></div>

      <div className="flex justify-between mt-6 pt-4 border-t-2 border-primary/30 font-heading text-lg font-semibold">
        <span>Net Income</span>
        <span className={`tabular-nums ${data.net_income >= 0 ? "text-primary" : "text-destructive"}`} data-testid="pl-net-income">{currency(data.net_income)}</span>
      </div>
    </Card>
  );
}

function BalanceSheet() {
  const { data, isLoading } = useQuery({ queryKey: ["bs"], queryFn: async () => (await api.get("/reports/balance-sheet")).data });
  if (isLoading) return <Loader />;
  return (
    <Card className="p-6 mt-4" data-testid="report-bs">
      <Section title="Assets" rows={data.assets} total={data.total_assets} totalTestId="bs-total-assets" />
      <Section title="Liabilities" rows={data.liabilities} total={data.total_liabilities} totalTestId="bs-total-liabilities" />
      <div className="mt-6">
        <h3 className="font-heading text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-1">Equity</h3>
        <div className="divide-y divide-border">
          {data.equity.map((r) => <LineRow key={r.code} {...r} amount={r.balance} />)}
          <LineRow name="Current Period Net Income" amount={data.net_income} />
        </div>
        <div className="flex justify-between border-t border-border mt-1 pt-2 font-medium text-sm"><span>Total equity</span><span className="tabular-nums">{currency(data.total_equity)}</span></div>
      </div>
      <div className={`flex items-center gap-2 mt-6 text-sm rounded-md px-3 py-2 ${data.balanced ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive"}`} data-testid="bs-balanced">
        {data.balanced ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
        {data.balanced ? "Balanced — Assets = Liabilities + Equity" : "Out of balance"}
        <span className="ml-auto tabular-nums">{currency(data.total_assets)} = {currency(data.total_liabilities + data.total_equity)}</span>
      </div>
    </Card>
  );
}

const Section = ({ title, rows, total, totalTestId }) => (
  <div className="mb-2">
    <h3 className="font-heading text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-1">{title}</h3>
    <div className="divide-y divide-border">
      {rows.length ? rows.map((r) => <LineRow key={r.code} {...r} amount={r.balance} />) : <p className="text-sm text-muted-foreground py-2">None.</p>}
    </div>
    <div className="flex justify-between border-t border-border mt-1 pt-2 font-medium text-sm"><span>Total {title.toLowerCase()}</span><span className="tabular-nums" data-testid={totalTestId}>{currency(total)}</span></div>
  </div>
);

function TrialBalance() {
  const { data, isLoading } = useQuery({ queryKey: ["tb"], queryFn: async () => (await api.get("/reports/trial-balance")).data });
  if (isLoading) return <Loader />;
  return (
    <Card className="mt-4 overflow-hidden" data-testid="report-tb">
      <Table>
        <TableHeader><TableRow><TableHead>Code</TableHead><TableHead>Account</TableHead><TableHead className="text-right">Debit</TableHead><TableHead className="text-right">Credit</TableHead></TableRow></TableHeader>
        <TableBody>
          {data.rows.filter((r) => r.debit || r.credit).map((r) => (
            <TableRow key={r.code}>
              <TableCell className="font-mono text-xs text-muted-foreground">{r.code}</TableCell>
              <TableCell>{r.name}</TableCell>
              <TableCell className="text-right tabular-nums">{r.debit ? currency(r.debit) : "—"}</TableCell>
              <TableCell className="text-right tabular-nums">{r.credit ? currency(r.credit) : "—"}</TableCell>
            </TableRow>
          ))}
          <TableRow className="font-semibold border-t-2 border-primary/30">
            <TableCell colSpan={2}>Totals</TableCell>
            <TableCell className="text-right tabular-nums" data-testid="tb-total-debit">{currency(data.total_debit)}</TableCell>
            <TableCell className="text-right tabular-nums" data-testid="tb-total-credit">{currency(data.total_credit)}</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </Card>
  );
}
