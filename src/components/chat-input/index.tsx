import { useState, useRef, useEffect, useCallback, type KeyboardEvent } from "react";
import { ArrowUp, Mic, MicOff, X, Pencil } from "lucide-react";
import { FileChip, ImageTile, PASTE_CARD_LINES, lineCount, pastedTitle } from "@/components/chat/user-message";
import type { PastedBlock } from "@/lib/types";
import { FileText } from "lucide-react";
import AttachMenu, { ACCEPT } from "./attach-menu";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { PromptInput, PromptInputTextarea, PromptInputFooter, PromptInputSubmit } from "@/components/ai-elements/prompt-input";
import ModeSelector from "@/components/mode-selector";
import type { ChatMode } from "@/lib/ai/modes";
import { appendTranscript } from "@/lib/append-transcript";
import { readCachedPrefs } from "@/lib/settings";
import { findMention, filterPlugins, removeMention } from "@/lib/plugins";
import { usePlugins } from "@/hooks/usePlugins";
import PluginIcon from "@/components/plugin-icon";
import { PLUGIN_BY_ID } from "@/lib/plugins/manifest";
import { Plus } from "lucide-react";
import { Popover, PopoverAnchor } from "@/components/ui/popover";
import PluginPicker from "@/components/plugin-picker";
import { isConversionRequest } from "@/lib/runtime/operations";

type Props = {
  toolName?: string;
  onSend: (message: string, imageData?: { base64: string; mimeType: string }, taskMode?: ChatMode, extras?: { typed: string; pasted: PastedBlock[] }, plugins?: string[]) => void;
  onZipUpload?: (file: File) => void;
  onFileConvert?: (file: File) => void;
  /** Documents, data and audio go to the backend task agent together with the typed instruction. */
  onSendFiles?: (message: string, files: File[], extras?: { typed: string; pasted: PastedBlock[] }, plugins?: string[]) => void;
  disabled?: boolean;
  /** Something is running (reply or task); the send button turns into a spinning stop button. */
  busy?: boolean;
  onStop?: () => void;
  /** Controlled mode for the current chat; it stays on until the user turns it off. */
  mode?: ChatMode;
  onModeChange?: (mode: ChatMode) => void;
};

const RemoveBtn = ({ label, onClick }: { label: string; onClick: () => void }) => (
  <button type="button" aria-label={label} onClick={onClick} className="absolute -right-2 -top-2 flex size-8 items-center justify-center rounded-full border border-border bg-background text-foreground shadow-sm"><X className="size-4" /></button>
);

const ChatInput = ({ toolName, onSend, onZipUpload, onFileConvert, onSendFiles, disabled, busy, onStop, mode, onModeChange }: Props) => {
  const [value, setValue] = useState("");
  const [attachedImage, setAttachedImage] = useState<{ base64: string; mimeType: string; preview: string; file?: File } | null>(null);
  const [plugins, setPlugins] = useState<string[]>([]);
  const { added: addedPlugins, loading: pluginsLoading } = usePlugins();
  const [pluginsOpen, setPluginsOpen] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [pasted, setPasted] = useState<PastedBlock[]>([]);
  const [localMode, setLocalMode] = useState<ChatMode>("default");
  // Uncontrolled fallback: start in the user's preferred default mode (Settings → AI Preferences).
  useEffect(() => { if (mode === undefined) setLocalMode(readCachedPrefs().defaultMode); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const taskMode = mode ?? localMode;
  const setTaskMode = onModeChange ?? setLocalMode;
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<any>(null);
  const finalTranscriptRef = useRef("");
  const acceptingSpeechRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Setup speech recognition
  useEffect(() => {
    const SpeechRecognitionAPI = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionAPI) return;

    const recognition = new SpeechRecognitionAPI();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event: any) => {
      if (!acceptingSpeechRef.current) return;
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          finalTranscriptRef.current = appendTranscript(finalTranscriptRef.current, event.results[i][0].transcript);
        } else {
          interim += event.results[i][0].transcript;
        }
      }
      const newValue = appendTranscript(finalTranscriptRef.current, interim);
      setValue(newValue);
      requestAnimationFrame(autoResize);
    };

    recognition.onerror = (e: any) => {
      console.warn("Speech recognition error:", e.error);
      acceptingSpeechRef.current = false;
      setIsListening(false);
    };
    recognition.onend = () => {
      acceptingSpeechRef.current = false;
      setIsListening(false);
    };

    recognitionRef.current = recognition;

    return () => {
      recognition.abort();
    };
  }, []);

  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, []);

  const toggleListening = () => {
    if (!recognitionRef.current) return;
    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
    } else {
      finalTranscriptRef.current = value;
      try {
        acceptingSpeechRef.current = true;
        recognitionRef.current.start();
        setIsListening(true);
      } catch (e) {
        acceptingSpeechRef.current = false;
        console.warn("Speech recognition start failed:", e);
      }
    }
  };

  const hasText = value.trim().length > 0;
  const hasContent = hasText || attachedImage || attachedFiles.length > 0 || pasted.length > 0;
  const showTray = !!attachedImage || attachedFiles.length > 0 || pasted.length > 0 || plugins.length > 0;

  // Pasting 50+ lines turns the text into its own card; shorter pastes stay normal text.
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const text = e.clipboardData.getData("text/plain");
    if (!text || lineCount(text) < PASTE_CARD_LINES) return;
    e.preventDefault();
    setPasted((cur) => [...cur, { title: pastedTitle(text), lines: lineCount(text), text }]);
  };
  const editPasted = (i: number) => {
    const block = pasted[i];
    setPasted((cur) => cur.filter((_, j) => j !== i));
    const next = value ? `${value}\n${block.text}` : block.text;
    setValue(next); finalTranscriptRef.current = next;
    requestAnimationFrame(autoResize);
  };

  const handleSend = () => {
    if (!hasContent || disabled) return;
    acceptingSpeechRef.current = false;
    if (isListening && recognitionRef.current) {
      recognitionRef.current.stop();
      setIsListening(false);
    }
    const typed = value.trim();
    const extras = pasted.length ? { typed, pasted } : undefined;
    const full = [typed, ...pasted.map((p) => p.text)].filter(Boolean).join("\n\n");
    setPasted([]);
    const chosen = plugins; setPlugins([]);
    // With a plugin selected or a format change asked for, an attached image is a source file for conversion, not a picture to describe.
    const asFile = !!attachedImage?.file && (chosen.length > 0 || isConversionRequest(full));
    const files = asFile ? [...attachedFiles, attachedImage!.file!] : attachedFiles;
    if (files.length && onSendFiles) {
      onSendFiles(full || (chosen.length ? "" : "Inspect these files and tell me what they contain."), files, extras ?? { typed, pasted: [] }, chosen);
      setValue(""); finalTranscriptRef.current = ""; setAttachedFiles([]); setAttachedImage(null);
      if (textareaRef.current) textareaRef.current.style.height = "auto";
      return;
    }
    onSend(
      full || (attachedImage ? "Analyze this image" : ""),
      attachedImage ? { base64: attachedImage.base64, mimeType: attachedImage.mimeType } : undefined,
      taskMode,
      extras,
      chosen
    );
    setValue("");
    finalTranscriptRef.current = "";
    setAttachedImage(null);
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  };

  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const mentionMatches = mention ? filterPlugins(addedPlugins, mention.query) : [];
  const updateMention = (text: string, caret: number) => { const m = findMention(text, caret); setMention(m); if (!m || m.query !== mention?.query) setMentionIndex(0); };
  const pickPlugin = (id: string) => {
    const el = textareaRef.current;
    setPlugins((cur) => (cur.includes(id) ? cur : [...cur, id]));
    setPluginsOpen(false);
    if (!mention || !el) {
      requestAnimationFrame(() => el?.focus());
      return;
    }
    const next = removeMention(value, mention.start, el.selectionStart ?? value.length);
    setValue(next.text); finalTranscriptRef.current = next.text; setMention(null);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(next.caret, next.caret); autoResize(); });
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (mention && mentionMatches.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setMentionIndex((i) => (i + 1) % mentionMatches.length); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setMentionIndex((i) => (i - 1 + mentionMatches.length) % mentionMatches.length); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pickPlugin(mentionMatches[Math.min(mentionIndex, mentionMatches.length - 1)].id); return; }
      if (e.key === "Escape") { e.preventDefault(); setMention(null); return; }
    }
    // On touch devices (mobile), Enter should insert a newline (default behavior).
    // Only submit on Enter when on a device with a real keyboard (fine pointer / hover).
    if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
    const isTouchDevice =
      typeof window !== "undefined" &&
      (window.matchMedia?.("(pointer: coarse)").matches ||
        window.matchMedia?.("(hover: none)").matches);
    if (isTouchDevice) {
      // Prevent the shared prompt control's desktop submission on touch devices.
      e.preventDefault();
      const el = textareaRef.current;
      if (!el) return;
      const start = el.selectionStart;
      const end = el.selectionEnd;
      setValue(value.slice(0, start) + "\n" + value.slice(end));
      requestAnimationFrame(() => { el.setSelectionRange(start + 1, start + 1); autoResize(); });
      return;
    }
    e.preventDefault();
    handleSend();
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    const file = picked[0];
    if (!file) return;
    if (picked.length > 1 && onSendFiles) {
      setAttachedFiles((cur) => [...cur, ...picked].slice(0, 10));
      e.target.value = "";
      return;
    }

    // Handle ZIP files
    if (file.name.toLowerCase().endsWith(".zip") || file.type === "application/zip" || file.type === "application/x-zip-compressed") {
      onZipUpload?.(file);
      e.target.value = "";
      return;
    }

    // Handle image files for chat attachment
    if (file.type.startsWith("image/") && !(e.target.dataset.convertMode && onSendFiles)) {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        const base64 = result.split(",")[1];
        setAttachedImage({ base64, mimeType: file.type, preview: result, file });
      };
      reader.readAsDataURL(file);
      e.target.value = "";
      return;
    }

    // Documents, data, audio (and images picked as files): attach for the task agent.
    const isVideo = file.type.startsWith("video/") || /\.(mp4|webm|mov|mkv|avi)$/i.test(file.name);
    // Videos up to 25 MB go to the task system (format conversion runs in the background runtime).
    if (onSendFiles && (!isVideo || file.size <= 25 * 1024 * 1024)) {
      setAttachedFiles((cur) => [...cur, file].slice(0, 10));
      e.target.value = "";
      return;
    }
    // Video stays with the in-browser converter.
    onFileConvert?.(file);
    e.target.value = "";
  };

  // Animated dots for prompt hint
  const [dotCount, setDotCount] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => {
      setDotCount((prev) => (prev + 1) % 4);
    }, 500);
    return () => clearInterval(interval);
  }, []);

  const animatedDots = ".".repeat(dotCount);

  return (
    <div className="w-full px-3 pb-3 pt-2 sm:px-4 sm:pb-4">
      <div className="relative max-w-2xl mx-auto">
        {mention && mentionMatches.length > 0 && (
          <div role="listbox" aria-label="Plugins" className="absolute bottom-full left-0 right-0 z-30 mb-2 max-h-[min(18rem,40dvh)] overflow-y-auto overscroll-contain rounded-2xl border border-border bg-popover p-1.5 text-popover-foreground shadow-lg">
            {mentionMatches.map((p, i) => (
              <div key={p.id} role="option" aria-selected={i === mentionIndex} aria-label={p.name} tabIndex={-1}
                onMouseDown={(e) => { e.preventDefault(); pickPlugin(p.id); }} onMouseEnter={() => setMentionIndex(i)}
                className={cn("flex w-full cursor-pointer items-center gap-3 rounded-xl px-2 py-1.5 text-left", i === mentionIndex ? "bg-accent text-accent-foreground" : "hover:bg-accent/60")}>
                <PluginIcon plugin={p} className="size-9" />
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{p.name}</span><span className="block truncate text-xs text-muted-foreground">{p.tagline}</span></span>
                <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border"><Plus className="size-4" /></span>
              </div>
            ))}
          </div>
        )}
        <Popover open={pluginsOpen} onOpenChange={setPluginsOpen}>
        <PopoverAnchor asChild><div>
        <PromptInput onSubmit={() => handleSend()} className="[&_[data-slot=input-group]]:rounded-[24px] [&_[data-slot=input-group]]:bg-card [&_[data-slot=input-group]]:shadow-none [&_[data-slot=input-group]]:ring-0! [&_[data-slot=input-group]]:focus-within:border-foreground/20">
          {/* Attachments and pasted prompts: same look as in the sent message */}
          {showTray && (
            <div className="flex w-full flex-wrap basis-full justify-start gap-3 self-stretch px-3 pt-4 pr-5">
              {attachedImage && (
                <ImageTile src={attachedImage.preview} alt="Attached image">
                  <RemoveBtn label="Remove attached image" onClick={() => setAttachedImage(null)} />
                </ImageTile>
              )}
              {attachedFiles.map((f, i) => (
                <FileChip key={`${f.name}-${i}`} name={f.name} kind={f.type.startsWith("image/") ? "image" : f.type.startsWith("video/") ? "video" : f.type.startsWith("audio/") ? "audio" : "file"}>
                  <RemoveBtn label={`Remove ${f.name}`} onClick={() => setAttachedFiles((cur) => cur.filter((_, j) => j !== i))} />
                </FileChip>
              ))}
              {plugins.map((id) => { const p = PLUGIN_BY_ID.get(id); if (!p) return null; return (
                <span key={id} className="relative flex h-[44px] items-center gap-2 rounded-full border border-border bg-card pl-1.5 pr-4">
                  <PluginIcon plugin={p} className="size-8 rounded-full" />
                  <span className="text-sm font-medium text-foreground">{p.name}</span>
                  <RemoveBtn label={`Remove ${p.name} plugin`} onClick={() => setPlugins((cur) => cur.filter((x) => x !== id))} />
                </span>
              ); })}
              {pasted.map((p, i) => (
                <div key={i} className="relative flex h-[72px] min-w-0 max-w-[260px] items-center gap-3 rounded-2xl border border-border bg-card pl-3 pr-5">
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-border bg-secondary"><FileText className="size-5 text-muted-foreground" /></span>
                  <span className="min-w-0">
                    <span className="block truncate text-[15px] font-medium text-foreground">{p.title}</span>
                    <span className="block text-xs text-muted-foreground">Markdown · {p.lines} lines</span>
                  </span>
                  <span className="absolute -right-2 -top-2 flex gap-1.5">
                    <button type="button" aria-label="Edit pasted text" onClick={() => editPasted(i)} className="flex size-8 items-center justify-center rounded-full border border-border bg-background text-foreground shadow-sm"><Pencil className="size-3.5" /></button>
                    <button type="button" aria-label="Remove pasted text" onClick={() => setPasted((cur) => cur.filter((_, j) => j !== i))} className="flex size-8 items-center justify-center rounded-full border border-border bg-background text-foreground shadow-sm"><X className="size-4" /></button>
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Textarea — grows vertically, shape stays the same */}
            <PromptInputTextarea
              ref={textareaRef}
              value={value}
              onChange={(e) => { setValue(e.target.value); finalTranscriptRef.current = e.target.value; autoResize(); updateMention(e.target.value, e.target.selectionStart ?? e.target.value.length); }}
              onBlur={() => setMention(null)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={`Ask Vision${animatedDots}`}
              aria-label="Message Vision"
              rows={1}
              className="w-full bg-transparent text-foreground text-[15px] placeholder:text-muted-foreground resize-none outline-none min-h-[44px] max-h-[200px] py-3 px-4 focus-visible:ring-0! focus-visible:ring-offset-0! shadow-none!"
            />

          {/* Action row */}
          <PromptInputFooter className="flex items-center justify-between gap-2 px-2 pb-2 pt-0">
            <div className="flex min-w-0 items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPT.image}
                onChange={handleFileSelect}
                className="hidden"
              />
              <AttachMenu
                onOpenPlugins={() => { setMention(null); setPluginsOpen(true); }}
                imageOnly={false}
                onPick={(kind) => {
                  const el = fileInputRef.current;
                  if (!el) return;
                  el.accept = ACCEPT[kind];
                  el.multiple = kind === "file" && !!onSendFiles;
                  el.dataset.convertMode = kind === "file" ? "1" : "";
                  el.click();
                }}
              />
              {<ModeSelector selectedMode={taskMode} onModeChange={setTaskMode} />}
            </div>

            <div className={cn(
              "relative h-8 shrink-0 transition-[width] duration-200 ease-out motion-reduce:transition-none",
              hasContent ? "w-[72px]" : "w-8"
            )}>
              <Button
                variant="ghost"
                size="icon"
                aria-label={isListening ? "Stop listening" : "Voice input"}
                type="button"
                onClick={toggleListening}
                className={cn(
                  "absolute left-0 top-0 size-8 shrink-0 rounded-full p-0 border transition-colors duration-200 motion-reduce:transition-none [&_svg]:size-[18px]",
                  isListening
                    ? "bg-destructive text-destructive-foreground border-destructive animate-pulse"
                    : "border-border text-muted-foreground hover:text-foreground hover:bg-accent"
                )}
                title={isListening ? "Stop listening" : "Voice input"}
              >
                {isListening ? <MicOff className="w-[18px] h-[18px]" /> : <Mic className="w-[18px] h-[18px]" />}
              </Button>
              {busy && onStop ? (
                <button
                  type="button"
                  onClick={onStop}
                  aria-label="Stop"
                  title="Stop"
                  className="absolute right-0 top-0 flex size-8 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition-opacity hover:opacity-80"
                >
                  <svg className="absolute inset-0 size-8 animate-spin motion-reduce:animate-none" viewBox="0 0 32 32" aria-hidden="true">
                    <circle cx="16" cy="16" r="14" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.5" />
                    <path d="M16 2a14 14 0 0 1 14 14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                  </svg>
                  <span className="size-2.5 rounded-[2px] bg-background" />
                </button>
              ) : (
              <PromptInputSubmit
                  aria-label="Send message"
                  title="Send message"
                  status={disabled ? "submitted" : "ready"}
                  disabled={disabled || !hasContent}
                  aria-hidden={!hasContent}
                  tabIndex={hasContent ? 0 : -1}
                  className={cn(
                    "absolute right-0 top-0 size-8 shrink-0 rounded-full p-0 border border-foreground bg-foreground text-background hover:opacity-80 transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none [&_svg]:size-[18px]",
                    hasContent ? "opacity-100 scale-100" : "pointer-events-none opacity-0 scale-75 disabled:opacity-0"
                  )}
                >
                  <ArrowUp className="w-[18px] h-[18px]" />
                </PromptInputSubmit>
              )}
            </div>
          </PromptInputFooter>
        </PromptInput>
        </div></PopoverAnchor>
        <PluginPicker plugins={addedPlugins} loading={pluginsLoading} onPick={pickPlugin} onClose={() => textareaRef.current?.focus()} />
        </Popover>

        {<p className="text-[11px] text-muted-foreground text-center mt-2 hidden sm:block">
          Vision may produce inaccurate results. Verify important information.
        </p>}
      </div>
    </div>
  );
};

export default ChatInput;
