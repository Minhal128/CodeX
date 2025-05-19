import { WebContainer } from '@webcontainer/api';

export const getWebContainer = async () => {
  try {
    const webcontainerInstance = await WebContainer.boot();
    return webcontainerInstance;
  } catch (err) {
    console.error("Error booting WebContainer:", err);
    return null;
  }
};

export default getWebContainer;