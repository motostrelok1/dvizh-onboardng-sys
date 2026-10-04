exports.up = (pgm) => {
  pgm.addColumn("assignments", {
    source_department_id: {
      type: "uuid",
      references: "departments",
      onDelete: "set null"
    }
  });
};

exports.down = (pgm) => {
  pgm.dropColumn("assignments", "source_department_id");
};
