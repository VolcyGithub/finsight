import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import api, { currency } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowUpRight, ArrowDownRight, Wallet, Receipt, TrendingUp,
  Sparkles, Database, UploadCloud,
} from "lucide-react";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  BarChart, Bar, PieChart, Pie, Cell, Legend,
} from "recharts";

const PIE_COLORS = ["hsl(137 18% 35%)", "hsl(181 16% 55%)", "hsl(16 42% 58%)", "hsl(43 40% 55%)", "hsl(200 25% 40%)", "hsl(137 12% 60%)"];

export default function Dashboard() {
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({
    queryKey: ["summary"],
    queryFn: async () => (await api.get("/dashboard/summary")).data,
  });

  const empty = data && data.transaction_count === 0;

  if (isLoading) {
    return (
      <div className="p-6 md:p-10 space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
        <Skeleton className="h-80" />
      </div>
    );
  }

  return (
    <div className="p-6 md:p-10 max-w-7xl fade-up">
      <header className="flex flex-wrap items-end justify-between gap-4 mb-8">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] font-semibold text-muted-foreground mb-2">Overview</p>
          <h1 className="font-heading text-3xl sm:text-4xl font-light tracking-tight">Financial Dashboard</h1>
        </div>
        <Button onClick={() => navigate("/insights")} data-testid="dashboard-analyze-btn" className="gap-2">
          <Sparkles className="h-4 w-4" /> AI Analysis
        </Button>
      </header>

      {empty ? (
        <EmptyState navigate={navigate} />
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 md:gap-6 mb-6">
            <Kpi label="Total Income" value={currency(data.total_income)} icon={ArrowUpRight} tone="up" testid="kpi-income" />
            <Kpi label="Total Expenses" value={currency(data.total_expense)} icon={ArrowDownRight} tone="down" testid="kpi-expense" />
            <Kpi label="Net Profit" value={currency(data.net_profit)} icon={Wallet} tone={data.net_profit >= 0 ? "up" : "down"} testid="kpi-profit" />
            <Kpi label="Transactions" value={data.transaction_count.toLocaleString()} icon={Receipt} tone="neutral" testid="kpi-count" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
            <Card className="lg:col-span-2 p-6" data-testid="cashflow-chart">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h3 className="font-heading text-lg font-medium">Cash Flow</h3>
                  <p className="text-xs text-muted-foreground">Income vs expenses by month</p>
                </div>
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
              </div>
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={data.monthly} margin={{ left: -10, right: 8 }}>
                  <defs>
                    <linearGradient id="inc" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(137 18% 35%)" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="hsl(137 18% 35%)" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="exp" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(16 42% 58%)" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="hsl(16 42% 58%)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(60 6% 89%)" vertical={false} />
                  <XAxis dataKey="month" stroke="hsl(60 2% 45%)" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis stroke="hsl(60 2% 45%)" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v) => currency(v)} contentStyle={{ borderRadius: 10, border: "1px solid hsl(60 6% 89%)", fontSize: 12 }} />
                  <Area type="monotone" dataKey="income" stroke="hsl(137 18% 35%)" strokeWidth={2} fill="url(#inc)" name="Income" />
                  <Area type="monotone" dataKey="expense" stroke="hsl(16 42% 58%)" strokeWidth={2} fill="url(#exp)" name="Expense" />
                </AreaChart>
              </ResponsiveContainer>
            </Card>

            <Card className="p-6" data-testid="category-chart">
              <h3 className="font-heading text-lg font-medium mb-1">Expense Breakdown</h3>
              <p className="text-xs text-muted-foreground mb-4">Top spending categories</p>
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie data={data.categories.slice(0, 6)} dataKey="amount" nameKey="category" cx="50%" cy="45%" innerRadius={55} outerRadius={85} paddingAngle={2}>
                    {data.categories.slice(0, 6).map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v) => currency(v)} contentStyle={{ borderRadius: 10, border: "1px solid hsl(60 6% 89%)", fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            </Card>

            <Card className="lg:col-span-3 p-6" data-testid="net-chart">
              <h3 className="font-heading text-lg font-medium mb-4">Monthly Net Profit</h3>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={data.monthly} margin={{ left: -10, right: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(60 6% 89%)" vertical={false} />
                  <XAxis dataKey="month" stroke="hsl(60 2% 45%)" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis stroke="hsl(60 2% 45%)" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v) => currency(v)} contentStyle={{ borderRadius: 10, border: "1px solid hsl(60 6% 89%)", fontSize: 12 }} />
                  <Bar dataKey="net" radius={[4, 4, 0, 0]}>
                    {data.monthly.map((m, i) => <Cell key={i} fill={m.net >= 0 ? "hsl(137 18% 35%)" : "hsl(1 47% 47%)"} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

const Kpi = ({ label, value, icon: Icon, tone, testid }) => {
  const toneColor = tone === "up" ? "text-primary" : tone === "down" ? "text-destructive" : "text-accent";
  return (
    <Card className="p-5 transition-transform duration-200 hover:-translate-y-1 hover:shadow-sm" data-testid={testid}>
      <div className="flex items-start justify-between">
        <p className="text-sm text-muted-foreground">{label}</p>
        <Icon className={`h-4 w-4 ${toneColor}`} />
      </div>
      <p className="font-heading text-2xl font-semibold mt-3 tracking-tight">{value}</p>
    </Card>
  );
};

const EmptyState = ({ navigate }) => (
  <Card className="p-12 text-center" data-testid="dashboard-empty">
    <div className="mx-auto h-14 w-14 rounded-full bg-secondary flex items-center justify-center mb-5">
      <Database className="h-6 w-6 text-primary" />
    </div>
    <h3 className="font-heading text-xl font-medium mb-2">No financial data yet</h3>
    <p className="text-sm text-muted-foreground max-w-md mx-auto mb-6">
      Import a CSV/Excel worksheet or load sample data to see your dashboard come alive with insights.
    </p>
    <Button onClick={() => navigate("/upload")} className="gap-2" data-testid="empty-import-btn">
      <UploadCloud className="h-4 w-4" /> Import data
    </Button>
  </Card>
);
