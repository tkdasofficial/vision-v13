import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import EmptyState from "@/components/empty-state";

describe("Empty chat screen", () => {
  it("shows only the logo and the tagline", () => {
    render(<EmptyState />);
    expect(screen.getByRole("heading", { name: "What can I help you with?" })).toBeInTheDocument();
    expect(screen.getAllByAltText("Vision")).toHaveLength(2); // light + dark logo
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryByText("Ask anything — answers, writing, code and plans.")).toBeNull();
  });
});
