export function millennium_mock(): Record<string, unknown> {
  return {
    Millennium: {
      callServerMethod: async () => ({ ok: true }),
      exposeObj: (object: unknown) => object,
    },
    sleep: async () => {},
    EAppAutoUpdateBehavior: { Always: 0, Launch: 1, HighPriority: 2 },
    DialogBodyText: () => null,
    DialogButton: () => null,
    DialogButtonPrimary: () => null,
    DialogHeader: () => null,
    ConfirmModal: () => null,
    showModal: () => ({ Close: () => {}, Update: () => {} }),
    toaster: { toast: () => ({ dismiss: () => {} }) },
  };
}
