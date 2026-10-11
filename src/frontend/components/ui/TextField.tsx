// src/frontend/components/ui/TextField.tsx — The text field and text area
// blocks (#251, spec #241).
//
// Both are one field block: a React Aria TextField with a label, an optional
// description and an optional inline feedback slot. The feedback slot carries a
// node from the feedback family (`FieldFeedback`), which is why this module
// renders the node instead of importing it — the family imports the blocks, so
// the blocks never import the family.

import type { ReactNode } from "react";
import {
  TextField as AriaTextField,
  type TextFieldProps as AriaTextFieldProps,
  Input,
  Label,
  Text,
  TextArea,
} from "react-aria-components";
import { withoutUndefined } from "./aria-props.js";

export interface TextFieldProps
  extends Omit<AriaTextFieldProps, "className" | "children"> {
  label: string;
  description?: string | undefined;
  /** Inline state feedback — a `FieldFeedback` node from the feedback family. */
  feedback?: ReactNode;
  /** The input's id, and the label's `htmlFor`. */
  inputId?: string | undefined;
  inputType?: string | undefined;
  placeholder?: string | undefined;
  className?: string | undefined;
}

export function TextField({
  label,
  description,
  feedback,
  inputId,
  inputType = "text",
  placeholder,
  className,
  ...props
}: TextFieldProps) {
  const classes = ["ui-field"];
  if (className !== undefined) classes.push(className);
  return (
    <AriaTextField {...withoutUndefined(props)} className={classes.join(" ")}>
      <Label className="ui-field-label">{label}</Label>
      <Input
        {...withoutUndefined({
          id: inputId,
          type: inputType,
          placeholder,
        })}
        className="ui-field-input"
      />
      {description !== undefined && (
        <Text slot="description" className="ui-field-description">
          {description}
        </Text>
      )}
      {feedback}
    </AriaTextField>
  );
}

export type TextAreaFieldProps = Omit<
  TextFieldProps,
  "inputType" | "placeholder"
>;

export function TextAreaField({
  label,
  description,
  feedback,
  inputId,
  className,
  ...props
}: TextAreaFieldProps) {
  const classes = ["ui-field"];
  if (className !== undefined) classes.push(className);
  return (
    <AriaTextField {...withoutUndefined(props)} className={classes.join(" ")}>
      <Label className="ui-field-label">{label}</Label>
      <TextArea
        {...withoutUndefined({ id: inputId })}
        className="ui-textarea"
      />
      {description !== undefined && (
        <Text slot="description" className="ui-field-description">
          {description}
        </Text>
      )}
      {feedback}
    </AriaTextField>
  );
}
