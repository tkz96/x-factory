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

/**
 * The label, and the accessory that rides in its row. A field without one
 * renders exactly the label it always did, so nothing else on a screen moves.
 */
function labelWithAccessory(label: string, accessory: ReactNode): ReactNode {
  const labelNode = <Label className="ui-field-label">{label}</Label>;
  if (accessory === undefined) return labelNode;
  return (
    <div className="ui-field-label-row">
      {labelNode}
      {accessory}
    </div>
  );
}

export interface TextFieldProps
  extends Omit<AriaTextFieldProps, "className" | "children"> {
  label: string;
  description?: string | undefined;
  /** Inline state feedback — a `FieldFeedback` node from the feedback family. */
  feedback?: ReactNode;
  /**
   * A control that belongs beside the label, in the label's own row — a field's
   * help button. It carries no layout of its own, so a field without one is
   * unchanged.
   */
  labelAccessory?: ReactNode;
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
  labelAccessory,
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
      {labelWithAccessory(label, labelAccessory)}
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

export type TextAreaFieldProps = Omit<TextFieldProps, "inputType"> & {
  /** The textarea's own `rows`, when a screen needs a taller field than the
   *  block's default of two tap targets. */
  rows?: number | undefined;
};

export function TextAreaField({
  label,
  description,
  feedback,
  labelAccessory,
  inputId,
  rows,
  placeholder,
  className,
  ...props
}: TextAreaFieldProps) {
  const classes = ["ui-field"];
  if (className !== undefined) classes.push(className);
  return (
    <AriaTextField {...withoutUndefined(props)} className={classes.join(" ")}>
      {labelWithAccessory(label, labelAccessory)}
      <TextArea
        {...withoutUndefined({ id: inputId, rows, placeholder })}
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
