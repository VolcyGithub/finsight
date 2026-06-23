import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import {
  LayoutDashboard, Receipt, UploadCloud, Sparkles, BellRing, Settings,
  LogOut, ShieldCheck, TrendingUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";

const nav = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, testid: "nav-dashboard", end: true },
  { to: "/transactions", label: "Transactions", icon: Receipt, testid: "nav-transactions" },
  { to: "/upload", label: "Import Data", icon: UploadCloud, testid: "nav-upload" },
  { to: "/insights", label: "AI Insights", icon: Sparkles, testid: "nav-insights" },
  { to: "/alerts", label: "Alerts", icon: BellRing, testid: "nav-alerts" },
  { to: "/settings", label: "Settings", icon: Settings, testid: "nav-settings" },
];

export default function AppLayout({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  return (
    <div className="min-h-screen flex bg-background text-foreground">
      <aside className="hidden md:flex w-64 flex-col border-r border-border bg-card/60 backdrop-blur-sm fixed h-screen">
        <div className="px-6 py-6 flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-lg bg-primary flex items-center justify-center">
            <TrendingUp className="h-5 w-5 text-primary-foreground" />
          </div>
          <div>
            <p className="font-heading font-bold text-lg leading-none">FinSight</p>
            <p className="text-xs text-muted-foreground mt-1">Private finance AI</p>
          </div>
        </div>

        <nav className="flex-1 px-3 space-y-1 mt-2">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              data-testid={item.testid}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-colors duration-200 ${
                  isActive
                    ? "bg-primary text-primary-foreground font-medium"
                    : "text-secondary-foreground hover:bg-secondary"
                }`
              }
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="px-3 py-4 border-t border-border">
          <div className="flex items-center gap-2 px-3 py-2 mb-2 text-xs text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5 text-primary" />
            Encrypted storage active
          </div>
          <div className="px-3 py-2 mb-1">
            <p className="text-sm font-medium truncate" data-testid="current-user-name">{user?.name}</p>
            <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
          </div>
          <Button
            variant="ghost"
            className="w-full justify-start gap-3 text-secondary-foreground hover:bg-secondary"
            onClick={handleLogout}
            data-testid="logout-button"
          >
            <LogOut className="h-4 w-4" /> Sign out
          </Button>
        </div>
      </aside>

      <main className="flex-1 md:ml-64 min-h-screen">{children}</main>
    </div>
  );
}
