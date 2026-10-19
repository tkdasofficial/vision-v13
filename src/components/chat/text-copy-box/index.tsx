import CodeBlock from "@/components/chat/code";

export default function TextCopyBox({ text, label = "Text" }: { text: string; label?: string }) {
  return <CodeBlock code={text} language="text" label={label} regionLabel={`${label} copy box`} />;
}