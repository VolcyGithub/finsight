import { useRef, useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { usePlaidLink } from "react-plaid-link";
import api, { formatApiErrorDetail } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  UploadCloud, FileSpreadsheet, HardDriveDownload, Sparkles, Loader2, CheckCircle2, Lock,
  FileSpreadsheet as SheetIcon, Download, Unplug, Landmark, RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

export default function Upload() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  const { data } = useQuery({
    queryKey: ["worksheets"],
    queryFn: async () => (await api.get("/worksheets")).data,
  });

  const uploadMut = useMutation({
    mutationFn: async (file) => {
      const fd = new FormData();
      fd.append("file", file);
      return (await api.post("/upload", fd, { headers: { "Content-Type": "multipart/form-data" } })).data;
    },
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ["worksheets"] });
      qc.invalidateQueries({ queryKey: ["summary"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
      toast.success(`Imported ${d.imported} transactions from ${d.filename}`);
    },
    onError: (e) => toast.error(formatApiErrorDetail(e.response?.data?.detail)),
  });

  const sampleMut = useMutation({
    mutationFn: async () => (await api.post("/sample-data")).data,
    onSuccess: (d) => {
      qc.invalidateQueries();
      toast.success(`Loaded ${d.imported} sample transactions`);
      navigate("/");
    },
    onError: (e) => toast.error(formatApiErrorDetail(e.response?.data?.detail)),
  });

  const handleFiles = (files) => {
    if (files && files[0]) uploadMut.mutate(files[0]);
  };

  return (
    <div className="p-6 md:p-10 max-w-5xl fade-up">
      <header className="mb-8">
        <p className="text-xs uppercase tracking-[0.2em] font-semibold text-muted-foreground mb-2">Import</p>
        <h1 className="font-heading text-3xl sm:text-4xl font-light tracking-tight">Bring in your data</h1>
        <p className="text-sm text-muted-foreground mt-2 flex items-center gap-1.5">
          <Lock className="h-3.5 w-3.5 text-primary" /> Every figure is encrypted before it touches the database.
        </p>
      </header>

      <div className="grid md:grid-cols-3 gap-6">
        <Card
          className={`p-8 border-2 border-dashed transition-colors duration-200 ${dragging ? "border-primary bg-primary/5" : "border-border"}`}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files); }}
          data-testid="upload-dropzone"
        >
          <div className="flex flex-col items-center text-center py-6">
            <div className="h-14 w-14 rounded-full bg-secondary flex items-center justify-center mb-4">
              {uploadMut.isPending ? <Loader2 className="h-6 w-6 text-primary animate-spin" /> : <UploadCloud className="h-6 w-6 text-primary" />}
            </div>
            <h3 className="font-heading text-lg font-medium">Upload a worksheet</h3>
            <p className="text-sm text-muted-foreground mt-1 mb-5">Drag & drop or browse — CSV or Excel (.xlsx)</p>
            <input ref={inputRef} type="file" accept=".csv,.xlsx,.xls,.txt" className="hidden"
              onChange={(e) => handleFiles(e.target.files)} data-testid="file-input" />
            <Button onClick={() => inputRef.current?.click()} disabled={uploadMut.isPending} data-testid="browse-file-btn">
              Choose file
            </Button>
          </div>
        </Card>

        <DriveSection />
        <PlaidSection />
      </div>

      <Card className="p-6 mt-6 bg-accent/5 border-accent/30" data-testid="sample-data-card">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Sparkles className="h-5 w-5 text-primary" />
            <div>
              <h3 className="font-heading font-medium">Just exploring?</h3>
              <p className="text-sm text-muted-foreground">Load 6 months of realistic sample business data instantly.</p>
            </div>
          </div>
          <Button variant="secondary" onClick={() => sampleMut.mutate()} disabled={sampleMut.isPending} data-testid="load-sample-btn">
            {sampleMut.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />} Load sample data
          </Button>
        </div>
      </Card>

      <div className="mt-8">
        <h3 className="font-heading text-lg font-medium mb-4">Recent imports</h3>
        {(!data?.worksheets || data.worksheets.length === 0) ? (
          <p className="text-sm text-muted-foreground" data-testid="no-imports">No imports yet.</p>
        ) : (
          <div className="space-y-2" data-testid="imports-list">
            {data.worksheets.map((w) => (
              <Card key={w.id} className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <FileSpreadsheet className="h-5 w-5 text-primary" />
                  <div>
                    <p className="font-medium text-sm">{w.filename}</p>
                    <p className="text-xs text-muted-foreground">{(w.created_at || "").slice(0, 10)} · {w.source}</p>
                  </div>
                </div>
                <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <CheckCircle2 className="h-4 w-4 text-primary" /> {w.row_count} rows
                </span>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function DriveSection() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [filesOpen, setFilesOpen] = useState(false);

  const { data: status, isLoading } = useQuery({
    queryKey: ["drive-status"],
    queryFn: async () => (await api.get("/drive/status")).data,
  });
  const connected = status?.connected;

  useEffect(() => {
    if (params.get("drive_connected")) {
      toast.success("Google Drive connected");
      qc.invalidateQueries({ queryKey: ["drive-status"] });
      params.delete("drive_connected");
      setParams(params, { replace: true });
    } else if (params.get("drive_error")) {
      toast.error("Could not connect Google Drive. Please try again.");
      params.delete("drive_error");
      setParams(params, { replace: true });
    }
  }, []); // eslint-disable-line

  const connectMut = useMutation({
    mutationFn: async () => (await api.get("/drive/connect")).data,
    onSuccess: (d) => { window.location.href = d.authorization_url; },
    onError: (e) => toast.error(formatApiErrorDetail(e.response?.data?.detail)),
  });

  const disconnectMut = useMutation({
    mutationFn: async () => (await api.post("/drive/disconnect")).data,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["drive-status"] }); toast.success("Drive disconnected"); },
  });

  return (
    <Card className="p-8" data-testid="gdrive-card">
      <div className="flex flex-col items-center text-center py-6">
        <div className="h-14 w-14 rounded-full bg-accent/15 flex items-center justify-center mb-4">
          <HardDriveDownload className="h-6 w-6 text-accent" />
        </div>
        <h3 className="font-heading text-lg font-medium">Google Drive</h3>
        {isLoading ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground mt-4" />
        ) : connected ? (
          <>
            <p className="text-sm text-muted-foreground mt-1 mb-5">Connected — import sheets straight from your Drive.</p>
            <div className="flex items-center gap-2">
              <Button onClick={() => setFilesOpen(true)} className="gap-2" data-testid="browse-drive-btn">
                <SheetIcon className="h-4 w-4" /> Browse files
              </Button>
              <Button variant="outline" onClick={() => disconnectMut.mutate()} disabled={disconnectMut.isPending} className="gap-2" data-testid="disconnect-drive-btn">
                <Unplug className="h-4 w-4" /> Disconnect
              </Button>
            </div>
            <Badge variant="secondary" className="mt-3 font-normal flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3 text-primary" /> Connected
            </Badge>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground mt-1 mb-5">Pull spreadsheets directly from your Drive folders.</p>
            <Button onClick={() => connectMut.mutate()} disabled={connectMut.isPending} className="gap-2" data-testid="connect-gdrive-btn">
              {connectMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Connect Drive
            </Button>
          </>
        )}
      </div>

      <DriveFilesDialog open={filesOpen} onOpenChange={setFilesOpen} onImported={() => {
        qc.invalidateQueries();
        setFilesOpen(false);
        navigate("/");
      }} />
    </Card>
  );
}

function DriveFilesDialog({ open, onOpenChange, onImported }) {
  const [importingId, setImportingId] = useState(null);
  const { data, isLoading, error } = useQuery({
    queryKey: ["drive-files"],
    queryFn: async () => (await api.get("/drive/files")).data,
    enabled: open,
  });

  const importFile = async (f) => {
    setImportingId(f.id);
    try {
      const res = await api.post("/drive/import", { file_id: f.id, name: f.name, mimeType: f.mimeType });
      toast.success(`Imported ${res.data.imported} transactions from ${f.name}`);
      onImported();
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail));
    } finally {
      setImportingId(null);
    }
  };

  const files = data?.files || [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Import from Google Drive</DialogTitle>
          <DialogDescription>Select a spreadsheet to import as transactions.</DialogDescription>
        </DialogHeader>
        <div className="max-h-96 overflow-y-auto -mx-1 px-1" data-testid="drive-files-list">
          {isLoading ? (
            <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
          ) : error ? (
            <p className="text-sm text-destructive py-6 text-center">Could not load files. Try reconnecting Drive.</p>
          ) : files.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">No spreadsheets found in your Drive.</p>
          ) : (
            <div className="space-y-2">
              {files.map((f) => (
                <div key={f.id} className="flex items-center justify-between gap-3 p-3 rounded-md border border-border hover:bg-secondary/60 transition-colors" data-testid={`drive-file-${f.id}`}>
                  <div className="flex items-center gap-3 min-w-0">
                    <FileSpreadsheet className="h-4 w-4 text-primary shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{f.name}</p>
                      <p className="text-xs text-muted-foreground">{(f.modifiedTime || "").slice(0, 10)}</p>
                    </div>
                  </div>
                  <Button size="sm" variant="secondary" className="gap-1.5 shrink-0" disabled={importingId === f.id}
                    onClick={() => importFile(f)} data-testid={`import-drive-file-${f.id}`}>
                    {importingId === f.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} Import
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PlaidSection() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [linkToken, setLinkToken] = useState(null);
  const [busy, setBusy] = useState(false);

  const { data: status, isLoading } = useQuery({
    queryKey: ["plaid-status"],
    queryFn: async () => (await api.get("/plaid/status")).data,
  });
  const items = status?.items || [];
  const connected = status?.connected;

  const onSuccess = useCallback(async (publicToken, metadata) => {
    setBusy(true);
    try {
      const res = await api.post("/plaid/exchange_public_token", {
        public_token: publicToken,
        institution_name: metadata?.institution?.name || "Bank",
      });
      toast.success(`Bank linked — imported ${res.data.imported} transactions`);
      qc.invalidateQueries();
      navigate("/");
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail));
    } finally {
      setBusy(false);
      setLinkToken(null);
    }
  }, [qc, navigate]);

  const startConnect = async () => {
    setBusy(true);
    try {
      const { data } = await api.post("/plaid/create_link_token");
      setLinkToken(data.link_token);
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail));
    } finally {
      setBusy(false);
    }
  };

  const syncMut = useMutation({
    mutationFn: async () => (await api.post("/plaid/sync")).data,
    onSuccess: (d) => { qc.invalidateQueries(); toast.success(`Synced ${d.imported} transactions`); },
    onError: (e) => toast.error(formatApiErrorDetail(e.response?.data?.detail)),
  });
  const disconnectMut = useMutation({
    mutationFn: async (itemId) => (await api.post(`/plaid/disconnect/${itemId}`)).data,
    onSuccess: () => { qc.invalidateQueries(); toast.success("Bank disconnected"); },
  });

  return (
    <Card className="p-8" data-testid="plaid-card">
      <div className="flex flex-col items-center text-center py-6">
        <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center mb-4">
          <Landmark className="h-6 w-6 text-primary" />
        </div>
        <h3 className="font-heading text-lg font-medium">Connect a Bank</h3>
        {isLoading ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground mt-4" />
        ) : connected ? (
          <>
            <p className="text-sm text-muted-foreground mt-1 mb-4">Your bank history syncs automatically.</p>
            <div className="w-full space-y-2 mb-4">
              {items.map((it) => (
                <div key={it.item_id} className="flex items-center justify-between gap-2 text-sm rounded-md border border-border px-3 py-2" data-testid={`plaid-item-${it.item_id}`}>
                  <span className="flex items-center gap-2 min-w-0"><Landmark className="h-3.5 w-3.5 text-primary shrink-0" /><span className="truncate">{it.institution_name}</span></span>
                  <button onClick={() => disconnectMut.mutate(it.item_id)} className="text-muted-foreground hover:text-destructive shrink-0" data-testid={`disconnect-plaid-${it.item_id}`}>
                    <Unplug className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <Button onClick={() => syncMut.mutate()} disabled={syncMut.isPending} className="gap-2" data-testid="plaid-sync-btn">
                {syncMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Sync now
              </Button>
              <Button variant="outline" onClick={startConnect} disabled={busy} className="gap-2" data-testid="plaid-add-btn">Add another</Button>
            </div>
            <Badge variant="secondary" className="mt-3 font-normal flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-primary" /> Connected</Badge>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground mt-1 mb-5">Auto-import your transaction history via Plaid.</p>
            <Button onClick={startConnect} disabled={busy} className="gap-2" data-testid="connect-bank-btn">
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} Connect Bank
            </Button>
            <Badge variant="secondary" className="mt-3 font-normal">Sandbox: user_good / pass_good</Badge>
          </>
        )}
      </div>
      {linkToken && <PlaidLauncher token={linkToken} onSuccess={onSuccess} onExit={() => setLinkToken(null)} />}
    </Card>
  );
}

function PlaidLauncher({ token, onSuccess, onExit }) {
  const { open, ready } = usePlaidLink({ token, onSuccess, onExit });
  useEffect(() => { if (ready) open(); }, [ready, open]);
  return null;
}
