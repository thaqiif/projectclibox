import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FolderOpen } from "lucide-react";
import { FolderPicker } from "@/components/FolderPicker";
import { useHomePath } from "@/hooks/useHomePath";

interface DirectoryFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  recentDirs: string[];
}

export function DirectoryField({
  label,
  value,
  onChange,
  recentDirs,
}: DirectoryFieldProps) {
  const [showPicker, setShowPicker] = useState(false);
  const { toTildePath } = useHomePath();

  const handleSelect = (absolutePath: string) => {
    onChange(toTildePath(absolutePath));
    setShowPicker(false);
  };

  return (
    <>
      <div className="space-y-2">
        <label className="text-sm font-medium">{label}</label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Input
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder="~/projects/my-app"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => setShowPicker(true)}
            title="Browse folders"
          >
            <FolderOpen className="h-4 w-4" />
          </Button>
        </div>
        {recentDirs.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-1">
            {recentDirs.map((dir) => (
              <button
                key={dir}
                type="button"
                onClick={() => onChange(dir)}
                className="bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground max-w-[200px] truncate rounded px-2 py-0.5 font-mono text-[0.6875rem] transition-colors"
                title={dir}
              >
                {dir.replace(/^~\//, "").split("/").pop() || dir}
              </button>
            ))}
          </div>
        )}
      </div>

      {showPicker && (
        <FolderPicker
          initialPath={value || "~"}
          onSelect={handleSelect}
          onClose={() => setShowPicker(false)}
        />
      )}
    </>
  );
}
