export default class Observer<A = void> {

	private observers = new Set<(arg: A) => void>();

	on(observer: (arg: A) => void): () => void {
		this.observers.add(observer);
		return () => this.observers.delete(observer);
	}

	trigger(arg: A): void {
		for (const observer of this.observers) observer(arg);
	}
}