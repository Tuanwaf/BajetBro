<script>
  import { formatMoney } from '../format.js';

  let { value } = $props();
</script>

<span>{formatMoney(value)}</span>
