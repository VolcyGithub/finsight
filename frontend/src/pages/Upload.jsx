import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import api, { formatApiErrorDetail } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  UploadCloud, FileSpreadsheet, HardDriveDownload, Sparkles, Loader2, CheckCircle2, Lock,
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

      <div className="grid md:grid-cols-2 gap-6">
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

        <Card className="p-8" data-testid="gdrive-card">
          <div className="flex flex-col items-center text-center py-6">
            <div className="h-14 w-14 rounded-full bg-accent/15 flex items-center justify-center mb-4">
              <HardDriveDownload className="h-6 w-6 text-accent" />
            </div>
            <h3 className="font-heading text-lg font-medium">Connect Google Drive</h3>
            <p className="text-sm text-muted-foreground mt-1 mb-5">Pull sheets directly from your Drive folders.</p>
            <Button variant="outline" disabled data-testid="connect-gdrive-btn">Connect Drive</Button>
            <Badge variant="secondary" className="mt-3 font-normal">Coming soon</Badge>
          </div>
        </Card>
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
