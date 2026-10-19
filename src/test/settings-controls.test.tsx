import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsChoice, SettingsToggle } from "@/components/settings/settings-ui";

vi.mock("@/lib/router-compat", () => ({ useNavigate: () => vi.fn() }));
afterEach(cleanup);

describe("Settings controls", () => {
  it("toggles from the label and reports the current value", () => {
    const change = vi.fn();
    function Fixture() {
      const [checked, setChecked] = useState(false);
      return <SettingsToggle label="Reduce motion" checked={checked} onChange={(v) => { change(v); setChecked(v); }} />;
    }
    render(<Fixture />);
    fireEvent.click(screen.getByText("Reduce motion"));
    expect(change).toHaveBeenLastCalledWith(true);
    expect(screen.getByRole("switch", { name: "Reduce motion" })).toBeChecked();
    fireEvent.click(screen.getByRole("switch", { name: "Reduce motion" }));
    expect(change).toHaveBeenLastCalledWith(false);
    expect(screen.getByRole("switch")).not.toBeChecked();
  });

  it("never changes a disabled notification setting", () => {
    const change = vi.fn();
    render(<SettingsToggle label="Chat replies" checked={false} disabled onChange={change} />);
    fireEvent.click(screen.getByText("Chat replies"));
    expect(change).not.toHaveBeenCalled();
    expect(screen.getByRole("switch")).toBeDisabled();
  });

  it("selects only the requested option", () => {
    const change = vi.fn();
    function Fixture() {
      const [value, setValue] = useState("system");
      return <SettingsChoice label="Theme" value={value} options={[{ value: "system", label: "System" }, { value: "dark", label: "Dark" }]} onChange={(v) => { change(v); setValue(v); }} />;
    }
    render(<Fixture />);
    fireEvent.click(screen.getByRole("radio", { name: "Dark" }));
    expect(change).toHaveBeenLastCalledWith("dark");
    expect(screen.getByRole("radio", { name: "Dark" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "System" })).not.toBeChecked();
  });
});