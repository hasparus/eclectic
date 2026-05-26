<script lang="ts">
	interface Props {
		onclose?: () => void;
		onedit_for_fun?: () => void;
		onlogin_success?: () => Promise<void> | void;
	}

	let {
		onclose = () => {},
		onedit_for_fun = () => {},
		onlogin_success = () => {}
	}: Props = $props();

	let email = $state('');
	let error = $state('');
	let pending = $state(false);
	let sent_to = $state<string | null>(null);
	let step = $state<'choice' | 'login' | 'sent'>('choice');
	let email_input_ref = $state<HTMLInputElement | undefined>();
	let should_focus_email_input = $state(false);

	$effect(() => {
		if (step !== 'choice') return;

		requestAnimationFrame(() => {
			if (document.activeElement instanceof HTMLElement) {
				document.activeElement.blur();
			}
		});
	});

	$effect(() => {
		if (step !== 'login' || !email_input_ref || !should_focus_email_input) return;

		requestAnimationFrame(() => {
			email_input_ref?.focus();
			email_input_ref?.select();
			should_focus_email_input = false;
		});
	});

	function reset_dialog() {
		email = '';
		error = '';
		pending = false;
		sent_to = null;
		step = 'choice';
		should_focus_email_input = false;
	}

	function close_auth_dialog() {
		reset_dialog();
		onclose();
	}

	function handle_edit_for_fun() {
		reset_dialog();
		onedit_for_fun();
	}

	function open_login_step() {
		step = 'login';
		error = '';
		email = '';
		should_focus_email_input = true;
	}

	async function send_magic_link() {
		if (pending) return;
		const trimmed = email.trim();
		if (!trimmed || !trimmed.includes('@')) {
			error = 'Enter a valid email address.';
			return;
		}

		pending = true;
		error = '';

		try {
			const api_module = await import('$lib/api.remote.js');
			const result = (await api_module.requestMagicLink({ email: trimmed })) as
				| { ok: true }
				| { ok: false; code: string; message: string };
			if (result.ok === false) {
				error = result.message || 'Could not send link.';
				return;
			}

			sent_to = trimmed;
			step = 'sent';
		} catch (err) {
			error = err instanceof Error ? err.message : 'Could not send link.';
		} finally {
			pending = false;
		}
	}

	function handle_email_keydown(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			void send_magic_link();
		}
	}
</script>

<div class="mx-auto flex w-full max-w-xl flex-col text-(--foreground)">
	{#if step === 'choice'}
		<div class="flex flex-col gap-7 px-2 pt-8 pb-2 sm:px-1 sm:gap-8">
			<div class="flex flex-col items-center gap-1 text-center">
				<h2 class="m-0 text-xl leading-[1.15] font-medium sm:text-2xl">
					You can edit this website
				</h2>
			</div>

			<div class="mx-auto grid w-full max-w-md min-w-0 grid-cols-2 gap-7 sm:max-w-sm sm:gap-7">
				<button
					type="button"
					class="flex w-full min-w-0 cursor-pointer flex-col justify-center gap-4 overflow-hidden rounded-[0.8rem] border border-[color-mix(in_oklch,var(--background)_91%,var(--foreground))] bg-(--background) px-2 py-5 text-center outline-1 outline-transparent transition-[background-color,border-color,transform] duration-200 ease-out hover:bg-[color-mix(in_oklch,var(--background)_96%,var(--foreground))] hover:border-[color-mix(in_oklch,var(--background)_88%,var(--foreground))] active:translate-y-px active:scale-95 active:bg-[color-mix(in_oklch,var(--background)_94%,var(--foreground))] active:border-[color-mix(in_oklch,var(--background)_84%,var(--foreground))] focus-visible:outline-1 focus-visible:outline-(--svedit-editing-stroke) focus-visible:outline-offset-1 sm:aspect-square sm:min-h-32 sm:gap-4 sm:p-4"
					onclick={handle_edit_for_fun}
				>
					<div class="flex items-center justify-center overflow-hidden">
						<svg
							class="size-8 sm:size-8"
							xmlns="http://www.w3.org/2000/svg"
							viewBox="0 0 15 15"
							fill="none"
							stroke-width="0.75"
							aria-hidden="true"
						>
							<path
								d="M12.6017 4.51322L10.4804 2.3919M12.6017 4.51322L3.76282 13.3521L1.77642 13.5C1.58297 13.5266 1.48259 13.4069 1.5 13.2107L1.6415 11.2308L10.4804 2.3919M12.6017 4.51322C12.9552 4.15965 12.9552 4.15969 12.9552 4.15969L13.3088 3.80612C13.6623 3.45255 13.4942 2.58389 12.9552 2.0384C12.4189 1.50211 11.541 1.33123 11.1875 1.6848L10.8339 2.03837C10.8339 2.03837 10.8339 2.03833 10.4804 2.3919"
								stroke="currentColor"
							/>
						</svg>
					</div>

					<div class="flex flex-col items-center gap-1 text-center sm:gap-1.5">
						<div class="text-[1rem] leading-none font-medium sm:text-[1.15rem]">Try editing</div>
						<div class="text-[0.68rem] leading-tight text-[color-mix(in_oklch,var(--foreground)_62%,transparent)] sm:text-xs">
							Won't save
						</div>
					</div>
				</button>

				<button
					type="button"
					class="flex w-full min-w-0 cursor-pointer flex-col justify-center gap-4 overflow-hidden rounded-[0.8rem] border border-[color-mix(in_oklch,var(--background)_91%,var(--foreground))] bg-(--background) px-2 py-5 text-center outline-1 outline-transparent transition-[background-color,border-color,transform] duration-200 ease-out hover:bg-[color-mix(in_oklch,var(--background)_96%,var(--foreground))] hover:border-[color-mix(in_oklch,var(--background)_88%,var(--foreground))] active:translate-y-px active:scale-95 active:bg-[color-mix(in_oklch,var(--background)_94%,var(--foreground))] active:border-[color-mix(in_oklch,var(--background)_84%,var(--foreground))] focus-visible:outline-1 focus-visible:outline-(--svedit-editing-stroke) focus-visible:outline-offset-1 sm:aspect-square sm:min-h-32 sm:gap-4 sm:p-4"
					onclick={open_login_step}
				>
					<div class="flex items-center justify-center overflow-hidden">
						<svg
							class="size-8 sm:size-8"
							xmlns="http://www.w3.org/2000/svg"
							viewBox="0 0 15 15"
							fill="none"
							stroke-width="0.75"
							aria-hidden="true"
						>
							<path d="M13.5 12.5C13.5 13.5 13.5 13.5 7.5 13.5C1.5 13.5 1.5 13.5 1.5 12.5C1.5 10.2 4.18629 8 7.5 8C10.8137 8 13.5 10.2 13.5 12.5Z" stroke="currentColor"></path>
							<path d="M10.5 3.75C10.5 5.40685 9.15685 6.75 7.5 6.75C5.84315 6.75 4.5 5.40685 4.5 3.75C4.5 2.09315 5.84315 0.75 7.5 0.75C9.15685 0.75 10.5 2.09315 10.5 3.75Z" stroke="currentColor"></path>
						</svg>
					</div>

					<div class="flex flex-col items-center gap-1 text-center sm:gap-1.5">
						<div class="text-[1rem] leading-none font-medium sm:text-[1.15rem]">Sign in</div>
						<div class="text-[0.68rem] leading-tight text-[color-mix(in_oklch,var(--foreground)_62%,transparent)] sm:text-xs">
							Email link
						</div>
					</div>
				</button>
			</div>
		</div>
	{:else if step === 'login'}
		<div class="mx-auto flex w-full max-w-lg flex-col gap-8 px-1 pt-8 pb-8">
			<div class="flex flex-col items-center gap-1 text-center">
				<h2 class="m-0 text-xl leading-[1.15] font-medium sm:text-2xl">
					Sign in with your email
				</h2>
				<p class="m-0 text-sm text-[color-mix(in_oklch,var(--foreground)_64%,transparent)]">
					We'll email you a link to sign in.
				</p>
			</div>

			<div class="flex items-stretch gap-2">
				<input
					type="email"
					bind:this={email_input_ref}
					bind:value={email}
					placeholder="you@example.com"
					autocomplete="email"
					class="min-w-0 flex-1 appearance-none rounded-[0.9rem] border border-[color-mix(in_oklch,var(--background)_92%,var(--foreground))] bg-(--background) px-4 py-3 text-base text-(--foreground) outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-[color-mix(in_oklch,var(--foreground)_52%,transparent)] hover:border-[color-mix(in_oklch,var(--background)_84%,var(--foreground))] focus:outline-none focus:ring-0 focus-visible:border-[color-mix(in_oklch,var(--background)_76%,var(--foreground))] focus-visible:shadow-[0_0_0_3px_color-mix(in_oklch,var(--background)_92%,var(--foreground))]"
					onkeydown={handle_email_keydown}
				/>

				<button
					type="button"
					class="inline-flex shrink-0 cursor-pointer items-center justify-center rounded-[0.8rem] border border-(--svedit-editing-stroke) bg-(--background) px-5 py-3 text-base font-semibold text-(--svedit-editing-stroke) shadow-sm outline-1 outline-transparent transition-all duration-150 hover:bg-[color-mix(in_oklch,var(--foreground)_4%,var(--background))] active:translate-y-px active:scale-95 active:bg-[color-mix(in_oklch,var(--foreground)_7%,var(--background))] focus-visible:outline-1 focus-visible:outline-(--svedit-editing-stroke) focus-visible:outline-offset-1"
					onclick={() => void send_magic_link()}
					disabled={pending}
				>
					{pending ? 'Sending…' : 'Send link'}
				</button>
			</div>

			{#if error}
				<div class="text-sm text-red-600">{error}</div>
			{/if}
		</div>
	{:else}
		<div class="mx-auto flex w-full max-w-lg flex-col gap-6 px-1 pt-8 pb-8 text-center">
			<h2 class="m-0 text-xl leading-[1.15] font-medium sm:text-2xl">Check your email</h2>
			<p class="m-0 text-sm text-[color-mix(in_oklch,var(--foreground)_64%,transparent)]">
				We sent a sign-in link to <span class="text-(--foreground)">{sent_to}</span>.
				Open it on this device to finish signing in.
			</p>
		</div>
	{/if}
</div>
