exports.up = (pgm) => {
  pgm.addColumns("lessons", {
    content_blocks: { type: "jsonb" },
    content_revision: { type: "integer", notNull: true, default: 0 }
  });
  pgm.addConstraint("lessons", "lessons_content_blocks_array_check", {
    check: "content_blocks is null or jsonb_typeof(content_blocks) = 'array'"
  });
  pgm.addConstraint("lessons", "lessons_content_revision_nonnegative", {
    check: "content_revision >= 0"
  });
};

exports.down = (pgm) => {
  pgm.dropConstraint("lessons", "lessons_content_revision_nonnegative");
  pgm.dropConstraint("lessons", "lessons_content_blocks_array_check");
  pgm.dropColumns("lessons", ["content_blocks", "content_revision"]);
};
