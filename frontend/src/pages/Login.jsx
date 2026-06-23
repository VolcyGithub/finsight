import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth, formatApiErrorDetail } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TrendingUp, ShieldCheck, Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";

export default function Login() {
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("admin@finsight.com");
  const [password, setPassword] = useState("admin123");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "login") await login(email, password);
      else await register(name, email, password);
      toast.success("Welcome to FinSight");
      navigate("/");
    } catch (err) {
      toast.error(formatApiErrorDetail(err.response?.data?.detail) || err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      <div className="hidden lg:flex flex-col justify-between p-12 bg-primary text-primary-foreground relative overflow-hidden">
        <div className="flex items-center gap-2.5 relative z-10">
          <div className="h-10 w-10 rounded-lg bg-primary-foreground/15 flex items-center justify-center">
            <TrendingUp className="h-6 w-6" />
          </div>
          <span className="font-heading font-bold text-xl">FinSight</span>
        </div>

        <div className="relative z-10 space-y-6 max-w-md">
          <h1 className="font-heading text-4xl xl:text-5xl font-light tracking-tight leading-tight">
            Your business finances, privately analyzed by AI.
          </h1>
          <p className="text-primary-foreground/80 leading-relaxed">
            Upload your worksheets and let intelligent analysis surface insights,
            suggest improvements, and flag anomalies before they cost you.
          </p>
          <div className="space-y-3 pt-4">
            <Feature icon={ShieldCheck} text="Encrypted-at-rest storage for every figure" />
            <Feature icon={Sparkles} text="Gemini-powered insights, alerts & suggestions" />
            <Feature icon={TrendingUp} text="Cash flow, profit & category breakdowns" />
          </div>
        </div>
        <div className="relative z-10 text-sm text-primary-foreground/60">
          Built for small & medium businesses
        </div>
        <div className="absolute -right-24 -bottom-24 h-96 w-96 rounded-full bg-accent/30 blur-3xl" aria-hidden="true" />
      </div>

      <div className="flex items-center justify-center p-6 sm:p-12 bg-background">
        <div className="w-full max-w-sm fade-up">
          <div className="lg:hidden flex items-center gap-2.5 mb-8">
            <div className="h-9 w-9 rounded-lg bg-primary flex items-center justify-center">
              <TrendingUp className="h-5 w-5 text-primary-foreground" />
            </div>
            <span className="font-heading font-bold text-lg">FinSight</span>
          </div>

          <h2 className="font-heading text-2xl font-medium tracking-tight">
            {mode === "login" ? "Welcome back" : "Create your account"}
          </h2>
          <p className="text-sm text-muted-foreground mt-1 mb-6">
            {mode === "login" ? "Sign in to your finance workspace" : "Start managing finances privately"}
          </p>

          <form onSubmit={submit} className="space-y-4" data-testid="auth-form">
            {mode === "register" && (
              <div>
                <Label htmlFor="name">Full name</Label>
                <Input id="name" data-testid="name-input" value={name}
                  onChange={(e) => setName(e.target.value)} required className="mt-1.5" placeholder="Jane Doe" />
              </div>
            )}
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" data-testid="email-input" value={email}
                onChange={(e) => setEmail(e.target.value)} required className="mt-1.5" />
            </div>
            <div>
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" data-testid="password-input" value={password}
                onChange={(e) => setPassword(e.target.value)} required className="mt-1.5" />
            </div>
            <Button type="submit" disabled={busy} className="w-full" data-testid="submit-auth-button">
              {busy && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {mode === "login" ? "Sign in" : "Create account"}
            </Button>
          </form>

          <p className="text-sm text-muted-foreground mt-6 text-center">
            {mode === "login" ? "No account yet?" : "Already have an account?"}{" "}
            <button
              className="text-primary font-medium hover:underline"
              onClick={() => setMode(mode === "login" ? "register" : "login")}
              data-testid="toggle-auth-mode"
            >
              {mode === "login" ? "Create one" : "Sign in"}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}

const Feature = ({ icon: Icon, text }) => (
  <div className="flex items-center gap-3">
    <Icon className="h-5 w-5 text-accent shrink-0" />
    <span className="text-sm text-primary-foreground/90">{text}</span>
  </div>
);
