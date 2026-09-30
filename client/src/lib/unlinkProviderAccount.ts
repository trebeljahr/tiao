type AccountClient = {
  listAccounts: () => Promise<{
    data?: { id: string; providerId: string }[] | null;
    error?: unknown;
  }>;
  unlinkAccount: (body: { accountId: string }) => Promise<{ error?: unknown }>;
};

/** Better Auth requires its account row ID, not the provider's user ID. */
export async function unlinkProviderAccount(
  client: AccountClient,
  providerId: string,
): Promise<void> {
  const { data, error } = await client.listAccounts();
  if (error) throw error;
  const matches = data?.filter((account) => account.providerId === providerId) ?? [];
  if (matches.length !== 1)
    throw new Error("Unable to identify the linked account. Refresh and try again.");
  const result = await client.unlinkAccount({ accountId: matches[0].id });
  if (result.error) throw result.error;
}
