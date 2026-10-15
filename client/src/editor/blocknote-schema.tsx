import { BlockNoteSchema, defaultBlockSpecs, defaultProps } from "@blocknote/core";
import { createReactBlockSpec } from "@blocknote/react";

export const calloutChoices = [
  { variant: "important", label: "Важно", icon: "❗" },
  { variant: "tip", label: "Совет", icon: "💡" },
  { variant: "warning", label: "Предупреждение", icon: "⚠️" },
  { variant: "example", label: "Пример", icon: "📝" },
  { variant: "remember", label: "Запомните", icon: "📌" }
] as const;
export type CalloutVariant = typeof calloutChoices[number]["variant"];

const createCallout = createReactBlockSpec(
  {
    type: "callout",
    propSchema: {
      textAlignment: defaultProps.textAlignment,
      textColor: defaultProps.textColor,
      variant: {
        default: "important" as const,
        values: ["important", "tip", "warning", "example", "remember"] as const
      }
    },
    content: "inline"
  },
  {
    render: ({ block, contentRef }) => {
      const choice = calloutChoices.find(item => item.variant === block.props.variant) ?? calloutChoices[0];
      return <div className="lms-callout" data-kind={choice.variant}>
        <span aria-hidden="true" className="lms-callout-icon" contentEditable={false}>{choice.icon}</span>
        <div className="lms-callout-content">
          <span className="lms-callout-label" contentEditable={false}>{choice.label}</span>
          <div className="lms-callout-text" ref={contentRef} />
        </div>
      </div>;
    }
  }
);

export const lessonBlockSchema = BlockNoteSchema.create({
  blockSpecs: {
    paragraph: defaultBlockSpecs.paragraph,
    heading: defaultBlockSpecs.heading,
    bulletListItem: defaultBlockSpecs.bulletListItem,
    numberedListItem: defaultBlockSpecs.numberedListItem,
    checkListItem: defaultBlockSpecs.checkListItem,
    toggleListItem: defaultBlockSpecs.toggleListItem,
    quote: defaultBlockSpecs.quote,
    codeBlock: defaultBlockSpecs.codeBlock,
    table: defaultBlockSpecs.table,
    image: defaultBlockSpecs.image,
    callout: createCallout()
  }
});
