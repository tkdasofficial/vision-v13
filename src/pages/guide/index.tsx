import { useState } from "react";
import * as Accordion from "@radix-ui/react-accordion";
import { BookOpen, ChevronDown, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SettingsPage } from "@/components/settings/settings-ui";
import { APP_GUIDE, filterGuide } from "@/lib/app-guide";

export default function GuidePage() {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string[]>(["navigation"]);
  const sections = filterGuide(APP_GUIDE, query);
  const searching = query.trim().length > 0;
  return <SettingsPage title="App Guide">
    <div className="flex items-center gap-3 px-4 py-2">
      <BookOpen className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <p className="text-sm leading-relaxed text-muted-foreground">Your guide to Vision, from the first chat to projects and gestures.</p>
    </div>
    <div className="drawer-floating relative rounded-full">
      <Search className="pointer-events-none absolute left-4 top-3.5 size-4 text-muted-foreground" aria-hidden="true" />
      <Input type="search" aria-label="Search App Guide" placeholder="Search the guide" value={query} onChange={(event) => setQuery(event.target.value)} className="rounded-full border-transparent pl-11 pr-12 [&::-webkit-search-cancel-button]:appearance-none" />
      {query && <Button variant="ghost" size="icon" aria-label="Clear guide search" className="absolute right-1 top-1 size-9 rounded-full" onClick={() => setQuery("")}><X className="size-4" /></Button>}
    </div>
    <Accordion.Root type="multiple" value={searching ? sections.map((section) => section.id) : expanded} onValueChange={setExpanded} className="space-y-2">
      {sections.map((section) => <Accordion.Item key={section.id} value={section.id}>
        <Accordion.Header><Accordion.Trigger asChild>
          <Button variant="floating" className="group h-auto min-h-12 w-full justify-between gap-3 whitespace-normal rounded-full px-5 py-3 text-left text-sm [&_svg]:size-4">
            <span>{section.title}</span><ChevronDown className="shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180 motion-reduce:transition-none" />
          </Button>
        </Accordion.Trigger></Accordion.Header>
        <Accordion.Content className="overflow-hidden data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down motion-reduce:animate-none">
          <div className="space-y-6 px-5 pb-6 pt-5">
            {section.entries.map((entry) => <article key={entry.title}>
              <h3 className="text-sm font-semibold text-foreground">{entry.title}</h3>
              <ul className="mt-2 list-disc space-y-2 pl-4 text-sm leading-relaxed text-muted-foreground">{entry.steps.map((step) => <li key={step}>{step}</li>)}</ul>
              {entry.note && <p className="mt-3 border-l-2 border-border pl-3 text-xs leading-relaxed text-muted-foreground">{entry.note}</p>}
            </article>)}
          </div>
        </Accordion.Content>
      </Accordion.Item>)}
    </Accordion.Root>
    {sections.length === 0 && <div role="status" className="px-5 py-10 text-center"><p className="text-sm text-muted-foreground">No matching topics.</p><Button variant="floating" className="mt-4 rounded-full" onClick={() => setQuery("")}>Clear search</Button></div>}
  </SettingsPage>;
}
