<script lang="ts">
	import { resolve } from '$app/paths';
	import TopBar from '#components/TopBar';
</script>

<svelte:head><title>pixelsort-go</title></svelte:head>

<TopBar />

<main class="home" data-testid="home">
	<section class="hero">
		<p class="eyebrow">Pixelsort · Go</p>
		<h1 class="display">Watch the <em>sort</em> happen.</h1>
		<p class="lede">
			A pixel sorter that runs in your browser. Bring a picture, drag the direction dial to any angle, and let the
			pixels fall into place — live, or as an animation.
		</p>
		<div class="cta">
			<a class="btn pri" href={resolve('/studio')}>Open Studio</a>
			<a class="btn" href={resolve('/archive')}>Archive</a>
			<a class="btn" href={resolve('/settings')}>Settings</a>
		</div>
	</section>

	<section class="cards" aria-label="Where to go">
		<a class="card" href={resolve('/studio')}>
			<span class="num">01</span>
			<b>Studio</b>
			<span>Bring a picture, choose the cut and the direction, then sort and animate.</span>
		</a>
		<a class="card" href={resolve('/archive')}>
			<span class="num">02</span>
			<b>Archive</b>
			<span>Save a look and it is kept with its recipe: reopen, branch, star, or clear the bin.</span>
		</a>
		<a class="card" href={resolve('/settings')}>
			<span class="num">03</span>
			<b>Settings</b>
			<span>Presets, sharing and expiry, the engine version, and the first-run tour.</span>
		</a>
	</section>

	<footer class="foot">
		<span class="eyebrow">The engine runs here, in WebAssembly</span>
		<span class="eyebrow">No accounts · Tailnet only</span>
	</footer>
</main>

<style>
	.home {
		position: relative;
		z-index: 10;
		min-height: 100dvh;
		max-width: 1120px;
		margin: 0 auto;
		padding: 132px 30px 56px;
		display: grid;
		align-content: center;
		gap: 64px;
	}
	.hero {
		max-width: 780px;
	}
	h1 {
		font-size: clamp(58px, 9vw, 118px);
		margin: 16px 0 24px;
	}
	.lede {
		max-width: 54ch;
		color: var(--dim);
		font-size: 13px;
		line-height: 1.95;
	}
	.cta {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
		margin-top: 32px;
	}
	.cards {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 12px;
	}
	.card {
		display: grid;
		gap: 8px;
		padding: 22px;
		border: 1px solid var(--faint);
		border-radius: 16px;
		background: linear-gradient(160deg, var(--ink2), rgba(20, 17, 15, 0.35));
		text-decoration: none;
		transition:
			border-color 0.2s,
			transform 0.2s;
	}
	.card:hover {
		border-color: var(--dim);
		transform: translateY(-2px);
	}
	.card b {
		font-family: var(--serif);
		font-weight: 400;
		font-size: 28px;
		line-height: 1;
	}
	.card span:last-child {
		color: var(--dim);
		font-size: 11.5px;
		line-height: 1.75;
	}
	.num {
		font-size: 10px;
		letter-spacing: 1.8px;
		color: var(--ver);
	}
	.foot {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: 12px;
		border-top: 1px solid var(--faint2);
		padding-top: 18px;
	}
	@media (max-width: 760px) {
		.home {
			padding: 118px 20px 40px;
			gap: 40px;
			align-content: start;
		}
		.cards {
			grid-template-columns: 1fr;
		}
	}
</style>
