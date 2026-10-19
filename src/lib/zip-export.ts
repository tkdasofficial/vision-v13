import JSZip from "jszip";
import { exportToDrive } from './drive-export';
import type { GeneratedFile } from "./web-preview-engine";

export async function downloadProjectAsZip(
  files: GeneratedFile[],
  framework: string,
  dependencies: Record<string, string>,
  projectName: string = "web-app"
): Promise<void> {
  const zip = new JSZip();

  // Add all generated files
  for (const file of files) {
    zip.file(file.path, file.content);
  }

  // Generate package.json if it doesn't exist and we have dependencies
  const hasPackageJson = files.some((f) => f.path === "package.json");
  if (!hasPackageJson && Object.keys(dependencies).length > 0) {
    const packageJson = generatePackageJson(projectName, framework, dependencies);
    zip.file("package.json", JSON.stringify(packageJson, null, 2));
  }

  // Generate README
  const hasReadme = files.some(
    (f) => f.path.toLowerCase() === "readme.md"
  );
  if (!hasReadme) {
    zip.file("README.md", generateReadme(projectName, framework));
  }

  // Generate and download
  const blob = await zip.generateAsync({ type: "blob" });
  await exportToDrive(blob, `${projectName}.zip`);
}

function generatePackageJson(
  name: string,
  framework: string,
  dependencies: Record<string, string>
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    name: name.toLowerCase().replace(/\s+/g, "-"),
    private: true,
    version: "1.0.0",
    type: "module",
  };

  if (framework === "react-vite") {
    base.scripts = {
      dev: "vite",
      build: "vite build",
      preview: "vite preview",
    };
    base.dependencies = {
      react: "^18.3.1",
      "react-dom": "^18.3.1",
      ...dependencies,
    };
    base.devDependencies = {
      "@vitejs/plugin-react": "^4.3.0",
      vite: "^5.4.0",
      typescript: "^5.5.0",
      "@types/react": "^18.3.0",
      "@types/react-dom": "^18.3.0",
    };
  } else if (framework === "nextjs-static") {
    base.scripts = {
      dev: "next dev",
      build: "next build",
      start: "next start",
    };
    base.dependencies = {
      next: "^14.0.0",
      react: "^18.3.1",
      "react-dom": "^18.3.1",
      ...dependencies,
    };
  } else {
    base.dependencies = dependencies;
  }

  return base;
}

function generateReadme(name: string, framework: string): string {
  const title = name.charAt(0).toUpperCase() + name.slice(1);

  if (framework === "react-vite") {
    return `# ${title}

Built with React + Vite + TypeScript.

## Getting Started

\`\`\`bash
npm install
npm run dev
\`\`\`

Open [http://localhost:5173](http://localhost:5173) in your browser.
`;
  }

  if (framework === "nextjs-static") {
    return `# ${title}

Built with Next.js + React + TypeScript.

## Getting Started

\`\`\`bash
npm install
npm run dev
\`\`\`

Open [http://localhost:3000](http://localhost:3000) in your browser.
`;
  }

  return `# ${title}

A static web page. Open \`index.html\` in your browser to view.
`;
}
