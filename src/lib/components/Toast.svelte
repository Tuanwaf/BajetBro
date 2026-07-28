<script>
  import { toastMessage, toastVisible } from '../toast.js';
</script>

<div class="toast" class:show={$toastVisible}>{$toastMessage}</div>
