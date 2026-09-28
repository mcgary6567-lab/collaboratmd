/** The insured person's fields from an insurance form (components/subscriber-fields.tsx). */
export function subscriberFrom(fd: FormData) {
  const f = (k: string) => String(fd.get(k) ?? "").trim() || undefined;
  return {
    firstName: f("subscriberFirstName"), lastName: f("subscriberLastName"), dob: f("subscriberDob"), sex: f("subscriberSex"),
    address1: f("subscriberAddress1"), city: f("subscriberCity"), state: f("subscriberState"), zip: f("subscriberZip"),
  };
}

export type SubscriberInput = Partial<ReturnType<typeof subscriberFrom>>;
