// src/frontend/components/ui/SelectField.tsx — The select block (#251,
// spec #241): a React Aria Select with the list in a popover, styled with
// tokens. Keyboard and screen-reader semantics are React Aria's (it renders a
// listbox, not a native menu), so the options are a plain data array.

import {
  Button as AriaButton,
  Select as AriaSelect,
  type SelectProps as AriaSelectProps,
  Label,
  ListBox,
  ListBoxItem,
  Popover,
  SelectValue,
} from "react-aria-components";
import { withoutUndefined } from "./aria-props.js";

export interface SelectOption {
  id: string;
  label: string;
}

export interface SelectFieldProps
  extends Omit<AriaSelectProps<object>, "className" | "children"> {
  label: string;
  options: readonly SelectOption[];
  className?: string | undefined;
}

export function SelectField({
  label,
  options,
  className,
  ...props
}: SelectFieldProps) {
  const classes = ["ui-field", "ui-select"];
  if (className !== undefined) classes.push(className);
  return (
    <AriaSelect {...withoutUndefined(props)} className={classes.join(" ")}>
      <Label className="ui-field-label">{label}</Label>
      <AriaButton className="ui-select-trigger">
        <SelectValue className="ui-select-value" />
        <span className="ui-select-indicator" aria-hidden="true" />
      </AriaButton>
      <Popover className="ui-select-popover" offset={4}>
        <ListBox className="ui-select-listbox" items={options}>
          {(option: SelectOption) => (
            <ListBoxItem id={option.id} className="ui-select-item">
              {option.label}
            </ListBoxItem>
          )}
        </ListBox>
      </Popover>
    </AriaSelect>
  );
}
